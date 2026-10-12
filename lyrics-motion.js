// Relógios independentes: pausar a rolagem não interrompe o fade.
const lyricMotion = {offset:0, running:false, ended:false, lastTime:null, speed:20, fadeStart:0};
function atualizarControlesRolagem() {
  const automatic=$('lyricsScrollMode').value==='auto';
  $('lyricsSpeed').disabled=!automatic;
  $('startLyrics').disabled=automatic && lyricMotion.running;
  $('pauseLyrics').disabled=!lyricMotion.running;
  $('lyricsScrollStatus').textContent=!automatic?'Rolagem desativada.':lyricMotion.ended?'Fim da letra. Reinicie para cantar novamente.':lyricMotion.running?'Rolagem em andamento.':'Rolagem pausada.';
}
function iniciarRolagemLetra() {
  $('lyricsScrollMode').value='auto';
  if(lyricMotion.ended) lyricMotion.offset=0;
  lyricMotion.ended=false;lyricMotion.running=true;lyricMotion.lastTime=performance.now();
  atualizarControlesRolagem();
}
function pararRolagemLetra() {
  lyricMotion.running=false;lyricMotion.lastTime=null;atualizarControlesRolagem();
}
function reiniciarRolagemLetra() {
  lyricMotion.offset=0;lyricMotion.ended=false;lyricMotion.lastTime=performance.now();
  if($('lyricsScrollMode').value==='auto') lyricMotion.running=true;
  atualizarControlesRolagem();
}
function atualizarVelocidadeRolagem() {
  lyricMotion.speed=+$('lyricsSpeed').value;
  $('lyricsSpeedValue').textContent=lyricMotion.speed+' px/s';
}
function atualizarRolagemLetra(now, maxOffset, visible) {
  const dt=lyricMotion.lastTime===null?0:Math.max(0,(now-lyricMotion.lastTime)/1000);
  lyricMotion.lastTime=now;
  if($('lyricsScrollMode').value!=='auto') return 0;
  // Tempo real, sem depender da taxa de quadros. Ocultar a letra suspende seu avanço.
  if(lyricMotion.running && visible) lyricMotion.offset+=dt*lyricMotion.speed;
  lyricMotion.offset=Math.min(lyricMotion.offset,Math.max(0,maxOffset));
  if(lyricMotion.running && visible && lyricMotion.offset>=maxOffset) {
    lyricMotion.running=false;lyricMotion.ended=true;atualizarControlesRolagem();
  }
  return lyricMotion.offset;
}
function reiniciarFadeLetra() {
  lyricMotion.fadeStart=performance.now();
  $('lyricsFadeValue').textContent=$('lyricsFadeDuration').value+' s';
  $('replayLyricsFade').disabled=$('lyricsFade').value==='none';
}
function opacidadeLetra(now) {
  const mode=$('lyricsFade').value;
  if(mode==='none') return 1;
  const progress=Math.max(0,Math.min(1,(now-lyricMotion.fadeStart)/(+$('lyricsFadeDuration').value*1000)));
  const eased=progress*progress*(3-2*progress);
  return mode==='in'?eased:1-eased;
}
function initializeLyricsMotion() {
  $('lyricsScrollMode').onchange=()=>{
    if($('lyricsScrollMode').value==='auto') iniciarRolagemLetra();
    else {pararRolagemLetra();lyricMotion.offset=0;lyricMotion.ended=false;}
  };
  $('startLyrics').onclick=iniciarRolagemLetra;
  $('pauseLyrics').onclick=pararRolagemLetra;
  $('restartLyrics').onclick=reiniciarRolagemLetra;
  $('lyricsSpeed').oninput=atualizarVelocidadeRolagem;
  $('lyricsFade').onchange=reiniciarFadeLetra;
  $('lyricsFadeDuration').oninput=reiniciarFadeLetra;
  $('replayLyricsFade').onclick=reiniciarFadeLetra;
  $('showLyrics').addEventListener('change',()=>{
    lyricMotion.lastTime=performance.now();
    if($('showLyrics').checked) reiniciarFadeLetra();
  });
  // Uma edição recomeça a leitura, preservando o estado de pausa.
  $('lyrics').addEventListener('input',()=>{lyricMotion.offset=0;lyricMotion.ended=false;lyricMotion.lastTime=performance.now();atualizarControlesRolagem();});
  atualizarVelocidadeRolagem();reiniciarFadeLetra();atualizarControlesRolagem();
}
