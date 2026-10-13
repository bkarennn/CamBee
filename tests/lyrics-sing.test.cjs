const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const source=readFileSync('lyrics-sing.js','utf8');
function setup(lyrics='Olá coração\ncanta comigo') {
  const elements=new Map();
  const $=id=>{
    if(!elements.has(id)) elements.set(id,{value:'',checked:false,disabled:false,textContent:'',listeners:{},
      addEventListener(type,callback){this.listeners[type]=callback;},dispatch(type){this.listeners[type]?.();}});
    return elements.get(id);
  };
  $('lyrics').value=lyrics;$('singProvider').value='browser';$('singLanguage').value='pt-BR';
  $('singServer').value='ws://localhost:3000/sing/ws/transcription';
  class Recognition {
    constructor(){Recognition.last=this;}
    start(){this.onstart?.();}
    abort(){this.aborted=true;this.onend?.();}
    emit(text,final=true,index=0){this.onresult({resultIndex:index,results:{length:index+1,[index]:{0:{transcript:text},isFinal:final}}});}
  }
  const calls=[];
  const ctx={font:'22px sans-serif',textAlign:'left',fillStyle:'#222',measureText:t=>({width:t.length*10}),fillText:(...a)=>calls.push(a),save(){},restore(){}};
  const sandbox={$ ,window:{isSecureContext:true,SpeechRecognition:Recognition,matchMedia:()=>({matches:false}),addEventListener(){}},
    performance:{now:()=>100},setTimeout,clearTimeout,URL,location:{protocol:'http:'},pararRolagemLetra(){},ctx};
  vm.createContext(sandbox);vm.runInContext(source,sandbox);vm.runInContext('initializeSinging()',sandbox);
  return {sandbox,$,Recognition,calls,run:code=>vm.runInContext(code,sandbox)};
}
(async()=>{
  let t=setup();
  assert.equal(t.run('singState.words.length'),4);
  assert.match(t.$('singPrepared').textContent,/4 palavras/);
  await t.run('startSinging()');
  t.Recognition.last.emit('OLA coração',false);
  assert.equal(t.run('singState.hits.size'),0,'interim hypotheses must not earn points');
  assert.equal(t.run('singState.preview.size'),2,'interim words get immediate visual feedback');
  assert.equal(t.run('singState.previewCursor'),2,'scroll follows interim words');
  const firstPulse=t.run('singState.preview.get(0)');
  t.Recognition.last.emit('OLA coração',false);
  assert.equal(t.run('singState.preview.get(0)'),firstPulse,'unchanged interim results do not replay the effect');
  t.Recognition.last.emit('OLA coração');
  assert.equal(t.run('singState.hits.size'),2,'case and accents should normalize');
  assert.equal(t.run('singState.preview.size'),0);
  assert.equal(t.run('singState.hits.get(0)'),firstPulse,'confirmation does not replay the effect');
  t.Recognition.last.emit('OLA coração');
  assert.equal(t.run('singState.hits.size'),2,'duplicate final result must not advance');
  t.Recognition.last.emit('canta comigo',true,1);
  assert.equal(t.run('singState.hits.size'),4);
  assert.equal(t.run('singState.session'),null,'completion should stop capture');
  assert.ok(t.Recognition.last.aborted);

  t=setup('la la la');await t.run('startSinging()');
  t.Recognition.last.emit('la la',false);
  assert.equal(t.run('singState.preview.size'),2);
  t.Recognition.last.emit('la',false);
  assert.equal(t.run('singState.preview.size'),1,'revised hypotheses roll back provisional words');
  assert.equal(t.run('singState.cursor'),0,'interim revisions never move committed position');
  t.Recognition.last.onresult({resultIndex:0,results:{length:0}});
  assert.equal(t.run('singState.preview.size'),0,'removed hypotheses clear highlights');
  t.Recognition.last.emit('la la la',false);
  assert.ok(t.run('singState.session'),'provisional completion must not stop recognition');
  t.Recognition.last.emit('la la');
  assert.equal(t.run('singState.cursor'),2,'final result commits only its actual words');
  assert.equal(t.run('singState.preview.size'),0);
  t.Recognition.last.emit('la',false,1);
  assert.equal(t.run('singState.previewCursor'),3);
  t.run('stopSinging()');assert.equal(t.run('singState.preview.size'),0);
  t.run('resetSinging()');assert.equal(t.run('singState.previewCursor'),0,'reset must return the visual position to the beginning');

  t=setup('la la la\nla la');await t.run('startSinging()');
  t.Recognition.last.emit('la la');
  assert.equal(t.run('singState.cursor'),2);
  t.Recognition.last.emit('la la');
  assert.equal(t.run('singState.cursor'),2);
  t.Recognition.last.emit('la la',true,1);
  assert.equal(t.run('singState.cursor'),4,'repeated words in new results count at their own positions');
  t.run('stopSinging()');t.Recognition.last.emit('la',true,2);
  assert.equal(t.run('singState.cursor'),4,'late callbacks after stopping are ignored');

  t=setup('um dois três quatro cinco seis sete oito nove dez');
  t.run("acceptSingingText('quatro')");assert.equal(t.run('singState.cursor'),0,'one stray word cannot jump forward');
  t.run("acceptSingingText('quatro cinco')");assert.equal(t.run('singState.cursor'),5);
  assert.equal(t.run('singState.hits.size'),5,'progress fills missed words through the inferred position');
  t.run('resetSinging()');assert.equal(t.run('singState.hits.size'),0);
  // Follow position using imperfect phrases rather than requiring each word to be correct.
  t=setup('A quiet morning by the river\nMy daddy cry\nThen we sing again');
  await t.run('startSinging()');
  t.Recognition.last.emit('All my dad Cry.',false);
  assert.equal(t.run('singState.previewCursor'),9,'the user example locates My daddy cry');
  assert.equal(t.run('singState.preview.size'),9,'all preceding words are visually traversed');
  assert.equal(t.run('singState.cursor'),0,'partial inference is still revisable');
  t.Recognition.last.emit('All my dad Cry.');
  assert.equal(t.run('singState.cursor'),9);
  assert.match(t.$('singProgress').textContent,/Progresso da letra/);
  assert.doesNotMatch(t.$('singProgress').textContent,/acertadas/);
  t.run('stopSinging()');
  t=setup('A quiet morning by the river\nMy daddy cry\nThen we sing again');
  t.run("acceptSingingText('dad cry')");
  assert.equal(t.run('singState.cursor'),9,'a short approximate anchor relocates without the missing my');
  t=setup('A quiet morning by the river\nMy daddy cry\nThen we sing again');
  t.run("acceptSingingText('purple computer galaxy')");
  assert.equal(t.run('singState.cursor'),0,'unrelated speech must not relocate the lyric');
  t=setup('we watch the stars above tonight\nwe watch the stars above tonight');
  t.run("acceptSingingText('stars above')");
  assert.equal(t.run('singState.cursor'),5,'repeated phrases prefer the nearest occurrence');
  t.run("acceptSingingText('tonight')");
  t.run("acceptSingingText('stars above')");
  assert.equal(t.run('singState.cursor'),11,'later refrains remain reachable in sequence');
  t=setup('one two three four five six seven eight nine ten eleven twelve\nMy daddy cry\nnext verse');
  t.run("acceptSingingText('dad cry')");
  assert.equal(t.run('singState.cursor'),15,'recovery is no longer limited to an eight-word window');
  t=setup('a calm evening\nI can hear the distant thunder\nunder the sky');
  t.run("acceptSingingText('hear distant thunder')");
  assert.equal(t.run('singState.cursor'),9,'missing words within the anchor do not block following');
  t=setup('na na na\nna na na\nmy daddy cry');
  t.run("acceptSingingText('dad')");
  assert.equal(t.run('singState.cursor'),0,'one vague syllable does not leap to a later verse');

  // Any inserted lyrics build their own vocabulary, offsets and line index.
  for(const [lyric,heard,expected] of [
    ['vento passa\nminha janela brilha\nna cidade','janela brila',5],
    ['cielo claro\nla luna ilumina\nnuestro camino','luna ilumina',5],
    ['le matin arrive\nune lumière dorée\nprès de nous','lumiere doree',6],
    ['тихий вечер\nяркие звёзды светят','яркие звезды',4]
  ]) {
    t=setup(lyric);t.sandbox.heard=heard;t.run('acceptSingingText(heard)');
    assert.equal(t.run('singState.cursor'),expected,`dynamic vocabulary should follow ${heard}`);
  }
  t=setup('old words here');await t.run('startSinging()');
  t.run("previewSingingText('old words')");
  t.$('lyrics').value='  Cafe\u0301,\tvento!\n\n🌟 outra canção.  ';
  t.$('lyrics').dispatch('input');
  assert.equal(t.run('singState.session'),null,'editing stops old recognition');
  assert.equal(t.run('singState.words.length'),4);
  assert.equal(t.run('singState.words[0].value'),'cafe','decomposed accents stay in the same token');
  assert.equal(t.run('singState.words[2].line'),2,'blank lines retain source line positions');
  assert.equal(t.run('singDocuments.get(singState.words).positions.has("old")'),false,'old vocabulary is discarded');
  assert.equal(t.run('singState.preview.size'),0,'old partial position is discarded');
  for(let i=0;i<4;i++) {
    t.sandbox.wordIndex=i;
    assert.equal(t.run('$("lyrics").value.slice(singState.words[wordIndex].sourceStart,singState.words[wordIndex].sourceEnd)'),t.run('singState.words[wordIndex].text'));
    assert.equal(t.run('$("lyrics").value.replace(/\\s/g,"").slice(singState.words[wordIndex].start,singState.words[wordIndex].end)'),t.run('singState.words[wordIndex].text'));
  }
  t.run('previewSingingText("outra canção")');
  assert.equal(t.run('singState.previewCursor'),4);
  t.run('globalThis.preparedDocument=singDocuments.get(singState.words);globalThis.cachedResult=preparedDocument.last.result');
  t.run('previewSingingText("outra canção")');
  assert.ok(t.run('preparedDocument.last.result===cachedResult'),'identical ASR hypotheses reuse the alignment');
  t=setup(Array(300).fill('vento noite caminho estrelas').join(' ')+'\nhorizonte violeta amanhecer');
  t.run('acceptSingingText("violeta amanhecer")');
  assert.equal(t.run('singState.cursor'),1203,'indexed recovery finds a distant unique phrase');
  t=setup('你好世界\n一起唱歌');
  assert.ok(t.run('singState.words.length')>2,'word segmentation also supports unspaced scripts');
  t=setup('');await t.run('startSinging()');assert.equal(t.run('singState.session'),null);
  t=setup();delete t.sandbox.window.SpeechRecognition;
  await t.run('startSinging()');assert.match(t.$('singStatus').textContent,/indisponível/);
  t=setup();await t.run('startSinging()');
  t.Recognition.last.onerror({error:'not-allowed'});
  assert.equal(t.run('singState.session'),null);assert.match(t.$('singStatus').textContent,/Permita/);

  t=setup('extraordinário amor');t.run("acceptSingingText('extraordinario')");
  t.run("drawSingingLyrics(['extraordi','nário amor'],570,160,30,140,100,true)");
  assert.ok(t.calls.some(c=>c[0]==='extraordi'));
  assert.ok(t.calls.some(c=>c[0]==='nário'),'a long matched word stays highlighted over wraps');

  // Real adapter with simulated protocol: validates device, binary format, duplicate packets and cleanup.
  t=setup('um dois três quatro cinco seis');t.$('singProvider').value='just-sing';
  let stopped=0,disconnected=0,closed=0,requested;
  const track={stop(){stopped++;}};
  const stream={getTracks:()=>[track],getAudioTracks:()=>[track]};
  class AudioContext {
    constructor(options){this.sampleRate=options.sampleRate;this.state='running';}
    async resume(){}
    async close(){closed++;this.state='closed';}
    createMediaStreamSource(){return {connect(){},disconnect(){disconnected++;}};}
    createScriptProcessor(size,inputs,outputs){assert.equal(size,2048);assert.equal(inputs,1);assert.equal(outputs,1);return {connect(){},disconnect(){disconnected++;}};}
  }
  class Socket {
    static OPEN=1;
    constructor(url){this.url=url;this.readyState=1;this.bufferedAmount=0;Socket.last=this;}
    send(data){this.sent=data;}
    close(){this.closed=true;}
    word(word,timestamp){this.onmessage({data:JSON.stringify({word,timestamp})});}
  }
  t.sandbox.AudioContext=AudioContext;t.sandbox.WebSocket=Socket;
  t.sandbox.navigator={mediaDevices:{getUserMedia:async options=>{requested=options;return stream;}}};
  t.$('microphoneDevice').value='studio-mic';
  await t.run('startSinging()');Socket.last.onopen();
  assert.equal(requested.audio.deviceId.exact,'studio-mic');
  t.sandbox.samples=new Float32Array(2048);
  t.run('singState.session.processor.onaudioprocess({inputBuffer:{getChannelData:()=>samples}})');
  assert.equal(Socket.last.sent.byteLength,2048*4);
  Socket.last.word('três',1);Socket.last.word('quatro',2);
  assert.equal(t.run('singState.cursor'),4,'single-word server packets can recover after missed words');
  Socket.last.word('quatro',2);assert.equal(t.run('singState.hits.size'),4);
  t.run('stopSinging()');assert.equal(stopped,1);assert.equal(disconnected,2);assert.equal(closed,1);assert.ok(Socket.last.closed);
  const late=Socket.last.onmessage;late({data:JSON.stringify({word:'cinco',timestamp:3})});
  assert.equal(t.run('singState.cursor'),4);

  // Cancelling while permission is pending must release the eventual stream.
  t.run('resetSinging()');let resolvePermission;
  t.sandbox.navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>{resolvePermission=resolve;});
  const pending=t.run('startSinging()');await new Promise(resolve=>setImmediate(resolve));
  t.run('stopSinging()');resolvePermission(stream);await pending;
  assert.equal(stopped,2);assert.equal(t.run('singState.session'),null);
  console.log('PASS: matching, repeats, interim/final deduplication, recovery, rendering, errors, websocket audio, cancellation and cleanup');
})().catch(error=>{console.error(error);process.exitCode=1;});
