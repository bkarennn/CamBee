// Cam Bee V0.3: recursos compartilhados pelo canvas e pela gravação.
const FONT_GROUPS = {
  'Clássicas': ['Arial','Times New Roman','Georgia'],
  'Pixeladas': ['Press Start 2P','Pixelify Sans','Silkscreen'],
  'Fofas e redondinhas': ['Fredoka','Nunito','Quicksand'],
  'Manuscritas e indie': ['Caveat','Patrick Hand'],
  'Acordes': ['monospace']
};
const SYSTEM_FONTS = new Set(['Arial','Times New Roman','Georgia','monospace']);
const fontState = {lyrics: {family:'sans-serif'}, chords: {family:'monospace'}};
let fontRevision=0, fontsPending=false, cameraBusy=false, recordingPreparing=false;
let importedBackground=null, backgroundRequest=0;
const pendingImageURLs = new Set();
const typographyControls=['lyricsFont','chordsFont','textBold','chordsBold','lyrics','chords'];

function hasLiveTrack(kind) {
  return !!cameraStream?.getTracks().some(t=>t.kind===kind && t.readyState==='live' && t.enabled && !t.muted);
}
function canRecord() {
  return !cameraBusy && !fontsPending && hasLiveTrack('video') && hasLiveTrack('audio') &&
    !!window.MediaRecorder && !!canvas.captureStream;
}
function refreshStudioControls() {
  const busy=recordingPreparing || (recorder && recorder.state!=='inactive');
  $('recordBtn').disabled=busy || !canRecord();
  $('cameraBtn').disabled=busy || cameraBusy;
  ['cameraDevice','microphoneDevice','refreshDevices'].forEach(id=>$(id).disabled=busy || cameraBusy);
  typographyControls.forEach(id=>$(id).disabled=!!busy);
}
function withTimeout(promise,ms,message) {
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),ms);})])
    .finally(()=>clearTimeout(timer));
}
async function loadSelectedFonts() {
  const revision=++fontRevision;
  fontsPending=true; refreshStudioControls();
  $('fontStatus').textContent='Carregando fontes… A gravação aguarda o carregamento.';
  const results=await Promise.all(['lyrics','chords'].map(async kind=>{
    const family=$(kind+'Font').value;
    const fallback=kind==='chords'?'monospace':'sans-serif';
    const weight=$(kind==='lyrics'?'textBold':'chordsBold').checked?'700':'400';
    if(SYSTEM_FONTS.has(family)) return {family,weight};
    try {
      if(!document.fonts) throw new Error('API de fontes indisponível');
      const loaded=await withTimeout(document.fonts.load(weight+' 22px "'+family+'"',$(kind).value || 'Música ação ♫'),12000,'Tempo de carregamento excedido');
      if(!loaded.length || loaded.some(face=>face.status!=='loaded')) throw new Error('Fonte indisponível');
      return {family,weight};
    } catch(error) {
      console.warn('[Cam Bee 0.3] Fonte:',family,error.message);
      return {family:fallback,weight,failed:family};
    }
  }));
  if(revision!==fontRevision) return;
  fontState.lyrics=results[0];fontState.chords=results[1];fontsPending=false;
  const failed=results.filter(r=>r.failed).map(r=>r.failed);
  $('fontStatus').textContent=failed.length ? 'Não foi possível carregar '+failed.join(', ')+'. Usando fonte alternativa na prévia e no vídeo.' : 'Fontes prontas para a prévia e a gravação.';
  refreshStudioControls();
}
function canvasTextFont(kind) {
  const state=fontState[kind];
  const family=['sans-serif','monospace'].includes(state.family)?state.family:'"'+state.family+'", '+(kind==='chords'?'monospace':'sans-serif');
  return (state.weight||'400')+' '+$('textSize').value+'px '+family;
}

function backgroundImageBox(image,mode,zoom,px,py) {
  let w=W,h=H;
  if(mode!=='stretch') {
    const scale=mode==='contain'?Math.min(W/image.naturalWidth,H/image.naturalHeight):Math.max(W/image.naturalWidth,H/image.naturalHeight);
    w=image.naturalWidth*scale;h=image.naturalHeight*scale;
  }
  w*=zoom;h*=zoom;
  return {x:(W-w)*px,y:(H-h)*py,w,h};
}
function drawImportedBackground() {
  if(!importedBackground) return;
  const b=backgroundImageBox(importedBackground,$('backgroundFit').value,+$('backgroundZoom').value/100,+$('backgroundX').value/100,+$('backgroundY').value/100);
  ctx.drawImage(importedBackground,b.x,b.y,b.w,b.h);
}
async function importBackground(file) {
  if(!file) return;
  const request=++backgroundRequest;
  const supported=['image/jpeg','image/png','image/webp'].includes(file.type) || (!file.type && /\.(jpe?g|png|webp)$/i.test(file.name));
  if(!supported) { $('backgroundStatus').textContent='Escolha uma imagem JPG, PNG ou WebP.';return; }
  const url=URL.createObjectURL(file);pendingImageURLs.add(url);
  $('backgroundStatus').textContent='Carregando imagem…';
  try {
    const img=new Image();
    await withTimeout(new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('Arquivo inválido ou corrompido'));img.src=url;}),15000,'A imagem demorou demais para carregar');
    if(request!==backgroundRequest) return;
    if(!img.naturalWidth || !img.naturalHeight) throw new Error('Imagem sem dimensões válidas');
    importedBackground=img;$('background').value='image';
    $('backgroundZoom').value=100;$('backgroundX').value=50;$('backgroundY').value=50;
    $('removeBackground').disabled=false;
    $('backgroundStatus').textContent=file.name+' — imagem local carregada.';
  } catch(error) {
    if(request===backgroundRequest) $('backgroundStatus').textContent='Não foi possível abrir a imagem: '+error.message;
  } finally { URL.revokeObjectURL(url);pendingImageURLs.delete(url); }
}

function mediaErrorMessage(error,kind) {
  const label=kind==='video'?'Câmera':'Microfone';
  const messages={
    NotAllowedError:'permissão negada ou acesso bloqueado pelo navegador/site. Confira as permissões e, se estiver em uma página incorporada, abra o site diretamente.',
    NotFoundError:'dispositivo não encontrado. Conecte o dispositivo e atualize a lista.',
    NotReadableError:'dispositivo indisponível ou em uso por outro aplicativo. Feche o outro aplicativo e tente novamente.',
    OverconstrainedError:'configuração ou dispositivo selecionado não suportado. Escolha o dispositivo padrão e tente novamente.',
    SecurityError:'acesso bloqueado pela política de segurança do navegador ou da página.',
    AbortError:'inicialização interrompida. Tente ligar novamente.'
  };
  console.error('[Cam Bee 0.3] '+label,{name:error.name,message:error.message,constraint:error.constraint,secure:window.isSecureContext,embedded:window.self!==window.top});
  return label+': '+(messages[error.name] || 'erro inesperado ('+(error.name||'Error')+'): '+error.message);
}
async function refreshDevices() {
  if(!navigator.mediaDevices?.enumerateDevices) { $('deviceStatus').textContent='Lista de dispositivos indisponível neste navegador/contexto.';return; }
  try {
    const devices=await navigator.mediaDevices.enumerateDevices();
    for(const [id,kind,label] of [['cameraDevice','videoinput','Câmera'],['microphoneDevice','audioinput','Microfone']]) {
      const select=$(id),previous=select.value;
      select.replaceChildren(new Option('Padrão do navegador',''));
      devices.filter(d=>d.kind===kind).forEach((d,i)=>select.add(new Option(d.label||label+' '+(i+1),d.deviceId)));
      select.value=[...select.options].some(o=>o.value===previous)?previous:'';
    }
    $('deviceStatus').textContent='Lista atualizada. Nomes podem aparecer somente após autorizar o acesso.';
  } catch(error) { $('deviceStatus').textContent='Não foi possível listar dispositivos: '+error.name;console.warn('[Cam Bee 0.3] enumerateDevices',error); }
}
async function startVideo(stream) {
  video.srcObject=stream;video.muted=true;video.playsInline=true;
  // Metadados e reprodução são etapas distintas: não libera gravação antes de ambas.
  await withTimeout(new Promise((resolve,reject)=>{
    let timer;
    const cleanup=()=>{clearTimeout(timer);video.removeEventListener('loadedmetadata',ready);video.removeEventListener('error',fail);};
    const ready=()=>{if(video.videoWidth>0 && video.videoHeight>0){cleanup();resolve();}};
    const fail=()=>{cleanup();reject(new Error('O elemento de vídeo não conseguiu carregar a câmera.'));};
    video.addEventListener('loadedmetadata',ready);video.addEventListener('error',fail);
    timer=setTimeout(fail,10000);ready();
  }),11000,'A câmera não forneceu metadados');
  await withTimeout(video.play(),10000,'O navegador não iniciou a reprodução da câmera');
}
async function connectDevices() {
  if(cameraBusy || recordingPreparing || (recorder && recorder.state!=='inactive')) return;
  cameraBusy=true;refreshStudioControls();
  $('status').textContent='Aguardando autorização da câmera…';
  console.info('[Cam Bee 0.3] Iniciar dispositivos',{secure:window.isSecureContext,mediaDevices:!!navigator.mediaDevices,embedded:window.self!==window.top});
  if(!navigator.mediaDevices?.getUserMedia) {
    $('status').textContent=window.isSecureContext ? 'Este navegador/contexto não disponibiliza acesso aos dispositivos. Abra o site diretamente em um navegador compatível.' : 'A API de câmera não está disponível neste contexto. Abra por HTTPS ou localhost.';
    cameraBusy=false;refreshStudioControls();return;
  }
  cameraStream?.getTracks().forEach(t=>t.stop());cameraStream=null;video.srcObject=null;
  const errors=[];
  try {
    const device=$('cameraDevice').value;
    try {
      const stream=await navigator.mediaDevices.getUserMedia({video:device?{deviceId:{exact:device}}:true,audio:false});
      cameraStream=stream;
      await startVideo(stream);
    } catch(error) {
      errors.push(mediaErrorMessage(error,'video'));
      cameraStream?.getTracks().forEach(t=>t.stop());cameraStream=null;video.srcObject=null;
    }
    $('status').textContent=(cameraStream?'Câmera ligada. ':'')+'Aguardando autorização do microfone…';
    try {
      const mic=$('microphoneDevice').value;
      const audio=await navigator.mediaDevices.getUserMedia({video:false,audio:mic?{deviceId:{exact:mic}}:true});
      if(cameraStream) audio.getAudioTracks().forEach(t=>cameraStream.addTrack(t));
      else audio.getTracks().forEach(t=>t.stop());
    } catch(error) { errors.push(mediaErrorMessage(error,'audio')); }
    if(cameraStream) {
      cameraStream.getTracks().forEach(track=>{
        const interrupted=()=>{
          refreshStudioControls();
          if(track.readyState==='ended' || track.muted) {
            if(recorder?.state==='recording') { recorder.interrupted=true;recorder.stop(); }
            $('status').textContent=(track.kind==='audio'?'Microfone':'Câmera')+' interrompido. Se havia gravação, confira o arquivo parcial e reconecte os dispositivos.';
          }
        };
        track.addEventListener('ended',interrupted);track.addEventListener('mute',interrupted);track.addEventListener('unmute',()=>refreshStudioControls());
      });
    }
    $('status').textContent=errors.length ? errors.join(' ') + (hasLiveTrack('video')?' A prévia continua; gravação com áudio exige microfone ativo.':'') : 'Câmera e microfone ligados! Ready to sing? ♡';
    await refreshDevices();
  } finally { cameraBusy=false;refreshStudioControls(); }
}
function initializeStudio() {
  for(const kind of ['lyrics','chords']) {
    const select=$(kind+'Font');
    for(const [label,families] of Object.entries(FONT_GROUPS)) {
      const group=document.createElement('optgroup');group.label=label;
      families.forEach(f=>group.append(new Option(f,f)));select.append(group);
    }
    select.value=kind==='lyrics'?'Nunito':'monospace';
  }
  typographyControls.forEach(id=>$(id).addEventListener('input',loadSelectedFonts));
  $('chooseBackground').onclick=()=>$('backgroundFile').click();
  $('backgroundFile').onchange=()=>{const file=$('backgroundFile').files[0];$('backgroundFile').value='';importBackground(file);};
  $('removeBackground').onclick=()=>{
    ++backgroundRequest;importedBackground=null;
    pendingImageURLs.forEach(url=>URL.revokeObjectURL(url));pendingImageURLs.clear();
    if($('background').value==='image') $('background').value='cream';
    $('removeBackground').disabled=true;$('backgroundStatus').textContent='Imagem removida.';
  };
  $('refreshDevices').onclick=refreshDevices;
  navigator.mediaDevices?.addEventListener?.('devicechange',refreshDevices);
  window.addEventListener('pagehide',()=>{
    cameraStream?.getTracks().forEach(t=>t.stop());
    pendingImageURLs.forEach(url=>URL.revokeObjectURL(url));pendingImageURLs.clear();
  });
  window.addEventListener('error',event=>console.error('[Cam Bee 0.3] JavaScript',event.message,event.filename,event.lineno));
  window.addEventListener('unhandledrejection',event=>console.error('[Cam Bee 0.3] Promise',event.reason));
  console.info('[Cam Bee 0.3] Arquivos carregados', {script:document.querySelector('script[src*="script.js"]')?.src,stylesheet:document.querySelector('link[href*="style.css"]')?.href});
  loadSelectedFonts();
  refreshStudioControls();
}
