// Independent adapter for Just Sing's Float32/24 kHz websocket protocol.
// Follow the likely position in the supplied lyrics, including imperfect transcription.
const singState = {words:[], hits:new Map(), preview:new Map(), previewCursor:0, cursor:0, following:false, session:null, layout:null};
const singNormalize = text => text.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[’']/g,'');
function singTokens(text) {
  return Array.from(text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu), match=>({text:match[0], value:singNormalize(match[0]), start:match.index, end:match.index+match[0].length}));
}
function sungWordSimilarity(a,b) {
  if(a===b) return 1;
  // Short function words are too ambiguous for fuzzy matching on their own.
  if(Math.min(a.length,b.length)<3) return 0;
  const shorter=a.length<b.length?a:b,longer=a.length<b.length?b:a;
  // Truncated sung endings: dad/daddy, cry/crying, cantar/cantando.
  if(longer.startsWith(shorter) && longer.length-shorter.length<=3) return .86;
  let previous=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++) {
    const row=[i];
    for(let j=1;j<=b.length;j++) row[j]=Math.min(row[j-1]+1,previous[j]+1,previous[j-1]+(a[i-1]===b[j-1]?0:1));
    previous=row;
  }
  return 1-previous[b.length]/Math.max(a.length,b.length);
}
function matchSungWords(words, spoken, cursor) {
  // Local sequence alignment: unrelated leading speech and missing lyric words
  // need not match. Keep recent context so long cumulative results remain cheap.
  spoken=spoken.slice(-18);
  let previous=Array(words.length-cursor+1).fill(null),best=null;
  for(let i=0;i<spoken.length;i++) {
    const row=[null];
    for(let j=cursor;j<words.length;j++) {
      const col=j-cursor+1,similarity=sungWordSimilarity(words[j].value,spoken[i].value);
      const diagonal=previous[col-1];
      const pairs=diagonal?.pairs || [];
      const options=[{
        score:(diagonal?.score || 0)+(similarity>=.6?2*similarity-.8:-1.1),
        pairs:similarity>=.6?[...pairs,{index:j,heard:i,similarity}]:pairs
      }];
      // Allow missed words and extra ASR words within a phrase.
      for(const neighbor of [previous[col],row[col-1]]) {
        if(neighbor) options.push({score:neighbor.score-.75,pairs:neighbor.pairs});
      }
      const cell=options.reduce((a,b)=>b.score>a.score?b:a);
      row[col]=cell.score>0?cell:null;
      if(!row[col] || similarity<.6) continue;
      const anchors=cell.pairs,last=anchors[anchors.length-1];
      if(!last || last.index!==j || last.heard!==i) continue;
      const first=anchors[0],distance=first.index-cursor;
      const mean=anchors.reduce((sum,p)=>sum+p.similarity,0)/anchors.length;
      const distinct=new Set(anchors.map(p=>words[p.index].value)).size;
      const evidence=anchors.reduce((sum,p)=>sum+Math.min(8,words[p.index].value.length),0);
      // A single word may continue the current position; relocation needs a phrase.
      if(anchors.length===1 && (distance!==0 || similarity<.8)) continue;
      if(distance>0 && (distinct<2 || mean<.78 || evidence<6)) continue;
      if(anchors.length/(last.index-first.index+1)<.5) continue;
      // Prefer coherent, recent phrases near the current verse over distant refrains.
      const rank=cell.score-.025*Math.min(distance,60)-.3*(spoken.length-1-i);
      if(!best || rank>best.rank+.0001) best={rank,end:j+1};
    }
    previous=row;
  }
  const end=best?.end ?? cursor;
  // Everything up to the inferred position has been traversed, not graded for accuracy.
  return {matches:Array.from({length:end-cursor},(_,i)=>cursor+i),cursor:end};
}
function updateSingProgress() {
  const position=Math.max(singState.cursor,singState.previewCursor);
  const percent=singState.words.length?Math.round(100*position/singState.words.length):0;
  $('singProgress').textContent=`Progresso da letra: ${percent}% · ${position} / ${singState.words.length} palavras`;
}
function previewSingingText(text) {
  const result=matchSungWords(singState.words,singTokens(text),singState.cursor);
  const previous=singState.preview;
  singState.preview=new Map(result.matches.map(index=>[index,previous.get(index) ?? performance.now()]));
  singState.previewCursor=result.cursor;updateSingProgress();
}
function resetSinging() {
  stopSinging();
  // Keep token boundaries from the original text, with compact offsets for wrapped lines.
  singState.words=singTokens($('lyrics').value).map(word=>({...word,
    start:$('lyrics').value.slice(0,word.start).replace(/\s/g,'').length,
    end:$('lyrics').value.slice(0,word.end).replace(/\s/g,'').length}));
  singState.hits.clear();singState.cursor=0;singState.previewCursor=0;singState.following=false;singState.layout=null;
  $('singHeard').textContent='—';updateSingProgress();
}
function acceptSingingText(text) {
  $('singHeard').textContent=text;
  const result=matchSungWords(singState.words,singTokens(text),singState.cursor);
  for(const index of result.matches) singState.hits.set(index,singState.preview.get(index) ?? performance.now());
  singState.cursor=result.cursor;updateSingProgress();
  if(singState.cursor===singState.words.length) stopSinging('Fim da letra! Volte ao início para cantar novamente.');
}
function stopSinging(message='Reconhecimento parado.') {
  const session=singState.session;singState.session=null;
  singState.preview.clear();singState.previewCursor=singState.cursor;updateSingProgress();
  if(session) {
    clearTimeout(session.timer);session.recognition?.abort();
    if(session.socket) {session.socket.onclose=null;session.socket.onerror=null;session.socket.close();}
    session.processor?.disconnect();session.source?.disconnect();
    session.stream?.getTracks().forEach(track=>track.stop());
    if(session.context && session.context.state!=='closed') session.context.close().catch(()=>{});
  }
  $('startSinging').disabled=false;$('stopSinging').disabled=true;
  ['singProvider','singLanguage','singServer'].forEach(id=>$(id).disabled=false);
  $('singStatus').textContent=message;
}
function updateSingingProvider() {
  const server=$('singProvider').value==='just-sing';
  $('singServerField').hidden=!server;$('singLanguageField').hidden=server;
  $('singPrivacy').textContent=server
    ?'Envia áudio ao servidor Just Sing e à Gradium. Usa o microfone selecionado no estúdio. O servidor precisa de uma chave Gradium.'
    :'O reconhecimento usa o microfone padrão e pode enviar áudio ao serviço do navegador. Use fones para evitar reconhecer a música de fundo.';
}
async function startSinging() {
  if(singState.session) return;
  if(!singState.words.length) {stopSinging('Cole uma letra antes de começar.');return;}
  if(!window.isSecureContext) {stopSinging('Abra por localhost ou HTTPS para usar o microfone.');return;}
  if(singState.cursor===singState.words.length) resetSinging();
  const session={};singState.session=session;
  const current=()=>singState.session===session;
  $('showLyrics').checked=true;
  pararRolagemLetra();
  $('startSinging').disabled=true;$('stopSinging').disabled=false;
  ['singProvider','singLanguage','singServer'].forEach(id=>$(id).disabled=true);
  $('singStatus').textContent='Conectando ao reconhecimento…';
  try {
    if($('singProvider').value==='browser') {
      const Recognition=window.SpeechRecognition || window.webkitSpeechRecognition;
      if(!Recognition) throw new Error('Reconhecimento indisponível neste navegador. Use Chrome ou o servidor Just Sing.');
      const recognition=new Recognition();session.recognition=recognition;
      recognition.lang=$('singLanguage').value;recognition.continuous=true;recognition.interimResults=true;
      const processed=new Set();
      recognition.onstart=()=>{if(current()) {singState.following=true;$('singStatus').textContent='Ouvindo… cante a letra.';}};
      recognition.onresult=event=>{
        if(!current()) return;
        for(let i=event.resultIndex;i<event.results.length;i++) {
          if(!current()) break;
          const result=event.results[i];$('singHeard').textContent=result[0].transcript;
          // Commit once; the visual feedback is already shown from interim hypotheses.
          if(result.isFinal && !processed.has(i)) {processed.add(i);acceptSingingText(result[0].transcript);}
        }
        if(!current()) return;
        // Rebuild from the committed cursor: revisions and shrinking result lists cannot
        // advance repeated lyrics twice or leave a stale provisional highlight behind.
        const pending=[];
        for(let i=0;i<event.results.length;i++) {
          if(event.results[i] && !event.results[i].isFinal) pending.push(event.results[i][0].transcript);
        }
        previewSingingText(pending.join(' '));
      };
      recognition.onerror=event=>{
        if(!current() || event.error==='no-speech') return;
        const errors={'not-allowed':'Permita o microfone para cantar.','service-not-allowed':'O serviço de voz está bloqueado.','audio-capture':'Microfone indisponível.','network':'Falha de rede no reconhecimento. Tente novamente.'};
        stopSinging(errors[event.error] || `Reconhecimento interrompido: ${event.error}.`);
      };
      recognition.onend=()=>{
        if(!current()) return;
        previewSingingText('');
        processed.clear();session.timer=setTimeout(()=>{
          if(current()) try {recognition.start();} catch {stopSinging('Não foi possível retomar. Clique em Começar a cantar.');}
        },350);
      };
      recognition.start();return;
    }
    const url=new URL($('singServer').value);
    if(!['ws:','wss:'].includes(url.protocol)) throw new Error('Use um endereço ws:// ou wss:// para o Just Sing.');
    if(location.protocol==='https:' && url.protocol!=='wss:') throw new Error('Nesta página HTTPS, o servidor deve usar wss://.');
    const context=new AudioContext({sampleRate:24000});session.context=context;
    await context.resume();if(!current()) return;
    if(context.sampleRate!==24000) throw new Error('Este dispositivo não suporta áudio a 24 kHz para o Just Sing.');
    const device=$('microphoneDevice').value;
    const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,...(device?{deviceId:{exact:device}}:{})}});
    if(!current()) {stream.getTracks().forEach(track=>track.stop());return;}
    session.stream=stream;
    stream.getAudioTracks()[0].onended=()=>{if(current()) stopSinging('O microfone foi desconectado.');};
    const socket=new WebSocket(url.href);session.socket=socket;
    session.timer=setTimeout(()=>{if(current()) stopSinging('O servidor Just Sing não respondeu. Confira o endereço e se ele está rodando.');},10000);
    socket.onerror=()=>{if(current()) stopSinging('Não foi possível conectar ao Just Sing. Confira o servidor e a chave Gradium.');};
    socket.onclose=()=>{if(current()) stopSinging('Conexão com Just Sing encerrada. Confira o servidor e tente novamente.');};
    const seen=new Set();
    socket.onmessage=event=>{
      if(!current()) return;
      try {
        const data=JSON.parse(event.data);
        if(typeof data.word!=='string') return;
        if(data.timestamp!==undefined) {
          const key=JSON.stringify([data.timestamp,data.word]);if(seen.has(key)) return;
          seen.add(key);if(seen.size>1000) seen.delete(seen.values().next().value);
        }
        // The server can deliver one word per packet; retain unmatched context for phrase recovery.
        const before=singState.cursor;
        session.pending=[...(session.pending || []),data.word].slice(-9);
        acceptSingingText(session.pending.join(' '));
        if(singState.cursor!==before) session.pending=[];
      } catch { /* Non-transcription messages do not count as sung words. */ }
    };
    socket.onopen=()=>{
      if(!current()) return;
      clearTimeout(session.timer);
      try {
        const source=context.createMediaStreamSource(stream);session.source=source;
        // Buffer format required by the original Just Sing server: mono Float32, 24 kHz.
        const processor=context.createScriptProcessor(2048,1,1);session.processor=processor;
        processor.onaudioprocess=event=>{
          if(!current() || socket.readyState!==WebSocket.OPEN) return;
          if(socket.bufferedAmount>24000*4*2) {stopSinging('Conexão lenta com Just Sing. Tente novamente.');return;}
          socket.send(event.inputBuffer.getChannelData(0).slice().buffer);
        };
        source.connect(processor);processor.connect(context.destination);
        singState.following=true;
        $('singStatus').textContent='Just Sing conectado. Cante a letra!';
      } catch {stopSinging('Não foi possível iniciar o áudio para Just Sing.');}
    };
  } catch(error) {
    if(current()) stopSinging(error.name==='NotAllowedError'?'Permita o microfone para cantar.':error.message);
  }
}
function drawSingingLyrics(lines,x,firstY,lineHeight,top,now,following) {
  // Compact character positions survive wrapping, including words split over two lines.
  const key=JSON.stringify([lines,ctx.font]);
  if(singState.layout?.key!==key) {
    let offset=0;
    const rows=lines.map(line=>{
      const chars=Array.from(line);const positions=[];
      let stringOffset=0;
      for(const char of chars) {
        if(!/\s/.test(char)) {positions.push({compact:offset,start:stringOffset,end:stringOffset+char.length});offset+=char.length;}
        stringOffset+=char.length;
      }
      const spans=[];
      singState.words.forEach((word,index)=>{
        const part=positions.filter(p=>p.compact>=word.start && p.compact<word.end);
        if(part.length) {
          const start=part[0].start,end=part[part.length-1].end;
          spans.push({index,text:line.slice(start,end),left:ctx.measureText(line.slice(0,start)).width});
        }
      });
      return {line,width:ctx.measureText(line).width,spans};
    });
    singState.layout={key,rows};
  }
  const rows=singState.layout.rows;
  const visualCursor=Math.max(singState.cursor,singState.previewCursor);
  const active=rows.findIndex(row=>row.spans.some(span=>span.index===Math.max(0,visualCursor-1)));
  const scroll=following?Math.max(0,active-1)*lineHeight:0;
  const align=ctx.textAlign,baseColor=ctx.fillStyle;
  rows.forEach((row,i)=>{
    const y=firstY+i*lineHeight-scroll;if(y<top-lineHeight || y>460+lineHeight) return;
    ctx.textAlign=align;ctx.fillStyle=baseColor;ctx.fillText(row.line,x,y);
    const left=x-(align==='center'?row.width/2:align==='right'?row.width:0);
    for(const span of row.spans) {
      const hitTime=singState.hits.get(span.index) ?? singState.preview.get(span.index);
      if(hitTime===undefined) continue;
      const age=now-hitTime,pulse=Math.max(0,1-age/650);
      ctx.save();ctx.textAlign='left';ctx.fillStyle='#8a4d00';
      if(pulse && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        ctx.shadowColor='#ffcf40';ctx.shadowBlur=14*pulse;
        ctx.fillStyle='#c57900';
        ctx.fillText('✦',left+span.left+ctx.measureText(span.text).width/2,y-lineHeight*.7-(1-pulse)*10);
      }
      ctx.fillText(span.text,left+span.left,y);ctx.restore();
    }
  });
  ctx.textAlign=align;ctx.fillStyle=baseColor;
}
function initializeSinging() {
  $('startSinging').onclick=startSinging;$('stopSinging').onclick=()=>stopSinging();
  $('resetSinging').onclick=resetSinging;
  $('lyrics').addEventListener('input',resetSinging);
  $('showLyrics').addEventListener('change',()=>{if(!$('showLyrics').checked) stopSinging('Letra oculta. Reconhecimento parado.');});
  $('singProvider').onchange=updateSingingProvider;
  $('restartLyrics').addEventListener('click',resetSinging);
  $('startLyrics').addEventListener('click',()=>{singState.following=false;});
  $('lyricsScrollMode').addEventListener('change',()=>{singState.following=false;});
  window.addEventListener('pagehide',()=>stopSinging());
  resetSinging();updateSingingProvider();
}
