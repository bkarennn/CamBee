
const $ = id => document.getElementById(id);

const canvas = $("canvas");
const ctx = canvas.getContext("2d");
const video = $("webcam");
const drawing = $("drawing");
const pen = drawing.getContext("2d");

let cameraStream = null;
let recorder = null;
let chunks = [];
let audioContext = null;
let audioSource = null;
let audioDestination = null;
let startedAt = performance.now();
let drawingActive = false;
let lastPoint = null;

const W = canvas.width;
const H = canvas.height;

// -------- FUNDOS --------

function drawBackground() {
  const bg = $("background").value;
  const colors = {
    cream: "#fff0d9",
    pink: "#f9c3d5",
    blue: "#b8d9ee",
    red: "#b7495b",
    checkered: "#f9d5e1",
    draw: "#fff4e5",
    image: "#fff4e5"
  };

  ctx.fillStyle = colors[bg];
  ctx.fillRect(0, 0, W, H);

  if (bg === "checkered") {
    const cell = 60;
    ctx.fillStyle = "#f9acc6";
    for (let y = 0; y < H; y += cell) {
      for (let x = 0; x < W; x += cell) {
        if ((x / cell + y / cell) % 2 === 0) {
          ctx.fillRect(x, y, cell, cell);
        }
      }
    }
  }

  if (bg === "image") drawImportedBackground();

  if (bg === "draw") {
    ctx.drawImage(drawing, 0, 0, W, H);
  }
}

// -------- MOLDURAS --------

function roundedRect(x, y, w, h, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
}

function makeShape(shape, x, y, w, h) {
  const cx = x + w / 2;
  const cy = y + h / 2;

  ctx.beginPath();

  if (shape === "circle") {
    ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else if (shape === "heart") {
    ctx.moveTo(cx, y + h * .93);
    ctx.bezierCurveTo(x - w * .1, y + h * .5, x, y, cx, y + h * .23);
    ctx.bezierCurveTo(x + w, y - h * .05, x + w * 1.1, y + h * .5, cx, y + h * .93);
  } else if (shape === "star") {
    for (let i = 0; i < 10; i++) {
      const a = i * Math.PI / 5 - Math.PI / 2;
      const r = i % 2 === 0 ? 1 : .48;
      const px = cx + Math.cos(a) * w * .5 * r;
      const py = cy + Math.sin(a) * h * .5 * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  } else if (["cat", "rabbit", "pizza", "paper", "flower"].includes(shape)) {
    const m=(a,b)=>ctx.moveTo(x+a*w,y+b*h);
    const l=(a,b)=>ctx.lineTo(x+a*w,y+b*h);
    const c=(a,b,d,e,f,g)=>ctx.bezierCurveTo(x+a*w,y+b*h,x+d*w,y+e*h,x+f*w,y+g*h);
    if (shape === "cat") {
      m(.08,.48); l(.1,.04); ctx.quadraticCurveTo(x+.12*w,y-.01*h,x+.35*w,y+.24*h);
      c(.45,.2,.55,.2,.65,.24); l(.88,.04); l(.93,.48);
      c(1,.8,.8,.98,.5,.98); c(.2,.98,0,.8,.08,.48);
    } else if (shape === "rabbit") {
      m(.2,.5); c(.06,-.15,.44,-.16,.44,.43);
      c(.48,.41,.52,.41,.56,.43); c(.56,-.16,.94,-.15,.8,.5);
      c(1,.65,.95,.98,.5,.98); c(.05,.98,0,.65,.2,.5);
    } else if (shape === "pizza") {
      m(.08,.2); c(.25,.02,.75,.02,.92,.2);
      c(.96,.23,.94,.27,.91,.32); l(.54,.94);
      c(.52,.98,.48,.98,.46,.94); l(.09,.32); c(.06,.27,.04,.23,.08,.2);
    } else if (shape === "flower") {
      for(let i=0;i<=240;i++) {
        const a=i/240*Math.PI*2, r=.42+.065*Math.cos(7*a);
        const px=cx+Math.cos(a)*w*r, py=cy+Math.sin(a)*h*r;
        if(!i) ctx.moveTo(px,py); else ctx.lineTo(px,py);
      }
    } else {
      m(.03,.03);
      for(let i=1;i<=16;i++) l(i/16*.94+.03,.03+.015*Math.sin(i*9));
      for(let i=1;i<=16;i++) l(.97+.014*Math.sin(i*7),i/16*.94+.03);
      for(let i=16;i>=0;i--) l(i/16*.94+.03,.97+.013*Math.sin(i*8));
      ctx.closePath();
      for(let i=0;i<7;i++) { ctx.moveTo(x+.105*w,y+(.12+i*.125)*h); ctx.ellipse(x+.085*w,y+(.12+i*.125)*h,w*.02,h*.02,0,0,Math.PI*2); }
    }
    ctx.closePath();
  } else {
    ctx.roundRect(x, y, w, h, shape === "square" ? 12 : 25);
  }
}

// -------- FILTROS --------

const filters = {
  none: "none",
  bw: "grayscale(100%)",
  warm: "sepia(35%) saturate(135%) contrast(105%)",
  pink: "sepia(18%) saturate(130%) hue-rotate(300deg)",
  blue: "sepia(25%) hue-rotate(155deg) saturate(120%)",
  red: "sepia(40%) hue-rotate(315deg) saturate(160%)",
  yellow: "sepia(45%) saturate(160%) brightness(110%)",
  vintage: "sepia(65%) contrast(85%) brightness(110%)"
};

function cameraBox() {
  const hasText = $("showLyrics").checked || $("showChords").checked;
  const area = { x: 25, y: 25, w: hasText ? 510 : 910, h: 460 };
  const scale = +$("cameraSize").value / 100;
  const wide = $("shape").value === "wide";
  const w = (wide ? area.w : Math.min(area.w, area.h)) * scale;
  const h = wide ? Math.min(area.h, w * 9 / 16) : w;
  return { x: area.x + (area.w-w) * +$("cameraX").value/100,
    y: area.y + (area.h-h) * +$("cameraY").value/100, w, h };
}

function drawWebcam(x, y, w, h, negative = false, extendEdges = false) {
  const scale = Math.max(w / video.videoWidth, h / video.videoHeight);
  const vw = video.videoWidth * scale, vh = video.videoHeight * scale;
  const selected = $("filter").value;
  const base = selected === "negative" ? `invert(${$("negativeAmount").value}%)` : filters[selected];
  ctx.filter = (base === "none" ? "" : base) + (negative ? " invert(100%)" : "") || "none";
  const dx=x+(w-vw)/2, dy=y+(h-vh)/2;
  if (extendEdges) {
    // Fora da imagem projetada, prolonga os pixels de borda sem deslocar o enquadramento.
    const xs=[0,dx,dx+vw,W], ys=[0,dy,dy+vh,H];
    const sx=[0,0,video.videoWidth-1], sy=[0,0,video.videoHeight-1];
    const sw=[1,video.videoWidth,1], sh=[1,video.videoHeight,1];
    for(let row=0;row<3;row++) for(let col=0;col<3;col++) {
      if(row===1 && col===1) continue;
      const dw=xs[col+1]-xs[col], dh=ys[row+1]-ys[row];
      if(dw>0 && dh>0) ctx.drawImage(video,sx[col],sy[row],sw[col],sh[row],xs[col],ys[row],dw,dh);
    }
  }
  ctx.drawImage(video, dx, dy, vw, vh);
  ctx.filter = "none";
}

function drawCamera() {
  const {x, y, w, h} = cameraBox();
  const shape = $("shape").value;

  ctx.save();
  ctx.shadowColor = "#74394b55";
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 9;

  makeShape(shape, x, y, w, h);
  ctx.fillStyle = "#fff8ef";
  ctx.fill("evenodd");
  ctx.restore();

  ctx.save();
  makeShape(shape, x, y, w, h);
  ctx.clip("evenodd");

  if (cameraStream && video.readyState >= 2) {
    drawWebcam(x, y, w, h);
  } else {
    ctx.fillStyle = "#edc2d2";
    ctx.fillRect(x, y, w, h);
    ctx.textAlign = "center";
    ctx.fillStyle = "#a45170";
    ctx.font = "bold 23px sans-serif";
    ctx.fillText("🐝 turn on your camera ♡", x+w/2, y+h/2);
  }

  drawEffect(x, y, w, h);
  ctx.restore();

  makeShape(shape, x, y, w, h);
  ctx.strokeStyle = "#fff8ef";
  ctx.lineWidth = 10;
  ctx.stroke();
}

// -------- EFEITOS --------

function starPath(px, py, radius, angle = 0, seed = 0) {
  ctx.beginPath();
  for (let j=0; j<10; j++) {
    const a = angle + j*Math.PI/5-Math.PI/2;
    const r = radius*(j%2 ? .46 : 1)*(1+.055*Math.sin(seed+j*7));
    const x=px+Math.cos(a)*r, y=py+Math.sin(a)*r;
    if (!j) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.closePath();
}

// Tamanhos independentes: o poá não altera pétalas nem estrelinhas.
const effectSettings = {
  stars: {sizeInput: 'starsSize', density: 1},
  dots: {sizeInput: 'dotsSize', density: 1.25},
  sakura: {sizeInput: 'sakuraSize', density: 1}
};

function drawEffect(x, y, w, h) {
  const effect = $("effect").value;
  const settings = effectSettings[effect];
  if (!settings) return;
  const t = (performance.now()-startedAt)/1000;
  const count = Math.ceil(+$("effectCount").value * settings.density);
  const configuredSize = +$(settings.sizeInput).value;
  const size = effect === "sakura" ? 15.5 * configuredSize / 100 : configuredSize;
  const amount = +$("effectAmount").value/100;
  for (let i=0; i<count; i++) {
    const u = ((i*.61803398875+.13)%1);
    let px = x + u*w + Math.sin(t*.45+i)*w*.025;
    const py = y + ((i*67+t*(10+i%5*3))%(h+size*2))-size;
    // Sakura em 100% recupera a faixa original de 16–31 px de altura.
    const r = effect === "sakura" ? (8 + (i%4)*2.5) * configuredSize / 100 : size*(.35+(i%5)*.12);
    ctx.save();
    ctx.globalAlpha = amount;
    if (effect === "stars") {
      // Deixa a região central menos ocupada por estrelas sólidas.
      if (u>.3 && u<.7) px=x+(u<.5 ? .2 : .8)*w;
      starPath(px,py,r,t*(i%2 ? .12 : -.08)+i,i);
      ctx.fillStyle = i%3 ? $("starColor").value : "#ffb3df";
      ctx.fill();
    } else if (effect === "sakura") {
      ctx.translate(px,py); ctx.rotate(i+t*(i%2 ? .35 : -.22));
      ctx.beginPath(); ctx.moveTo(0,-r);
      ctx.bezierCurveTo(r,-r*.8,r*.9,r*.5,0,r);
      ctx.bezierCurveTo(-r*.7,r*.2,-r,-r*.8,-r*.18,-r*.7);
      ctx.quadraticCurveTo(-r*.05,-r*.5,0,-r);
      ctx.fillStyle=["#ffd4e2","#e98fae","#fff7fa"][i%3]; ctx.fill();
    } else if (effect === "dots") {
      // Distribuição estável nas laterais, protegendo o centro do rosto.
      const radius = Math.min(size * (.4 + ((i*7)%11)/10), w*.095, h*.14);
      if (u>.3 && u<.7) px=x+(u<.5 ? .08+u*.38 : .65+u*.28)*w;
      ctx.globalAlpha = amount*.8;
      ctx.beginPath(); ctx.arc(px,py,radius,0,Math.PI*2);
      ctx.fillStyle=["#ea6786","#ffe168","#75afbf","#8761af"][i%4]; ctx.fill();
    }
    ctx.restore();
  }
}

// -------- LETRA E ACORDES --------

function drawWrappedText(text, x, y, maxWidth, lineHeight, font) {
  ctx.font = font;

  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(" ");
    let line = "";

    for (const word of words) {
      const test = line ? line + " " + word : word;

      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, y);
        y += lineHeight;
        line = word;
      } else {
        line = test;
      }
    }

    ctx.fillText(line, x, y);
    y += lineHeight;
  }
  return y;
}

function drawLyrics() {
  const showLyrics = $("showLyrics").checked;
  const showChords = $("showChords").checked;

  if (!showLyrics && !showChords) return;

  ctx.save();
  ctx.fillStyle = $("textColor").value;
  ctx.textAlign = $("textAlign").value;
  const textX = ctx.textAlign === "center" ? 742.5 : ctx.textAlign === "right" ? 915 : 570;
  // O título acompanha o campo e a mesma fonte já carregada da letra.
  const title = $("songTitle").value.trim();
  if (title) {
    ctx.font = canvasTextFont("lyrics", Math.min(40, +$("textSize").value * 1.25));
    ctx.fillText(title, textX, 113, 345);
  }
  let y = 170;

  // Recorta o texto para não ultrapassar a área.
  ctx.beginPath();
  ctx.rect(560, 140, 370, 320);
  ctx.clip();

  if (showChords) {
    y = drawWrappedText(
      $("chords").value,
      textX, y, 345, +$("textSize").value*1.4, canvasTextFont("chords")
    );
    y += 15;
  }

  if (showLyrics) {
    drawWrappedText(
      $("lyrics").value,
      textX, y, 345, +$("textSize").value*1.5, canvasTextFont("lyrics")
    );
  }

  ctx.restore();
}

// -------- RENDERIZAÇÃO --------

function render() {
  ctx.clearRect(0, 0, W, H);

  drawBackground();
  drawDecorations("background");
  drawCamera();
  drawDecorations("foreground");
  drawLyrics();

  ctx.fillStyle = "#81445a";
  ctx.textAlign = "center";
  ctx.font = "bold 16px sans-serif";
  ctx.fillText("made with love ♡ cam bee", W/2, H-19);

  requestAnimationFrame(render);
}

// Iniciado após carregar os controles de decoração.

// -------- DESENHAR NO FUNDO --------

function pointFromEvent(event) {
  const rect = drawing.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * drawing.width / rect.width,
    y: (event.clientY - rect.top) * drawing.height / rect.height
  };
}

drawing.addEventListener("pointerdown", event => {
  drawingActive = true;
  lastPoint = pointFromEvent(event);
  drawing.setPointerCapture(event.pointerId);
});

drawing.addEventListener("pointermove", event => {
  if (!drawingActive) return;

  const point = pointFromEvent(event);

  pen.strokeStyle = $("penColor").value;
  pen.lineWidth = 4;
  pen.lineCap = "round";
  pen.lineJoin = "round";
  pen.beginPath();
  pen.moveTo(lastPoint.x, lastPoint.y);
  pen.lineTo(point.x, point.y);
  pen.stroke();

  lastPoint = point;
});

drawing.addEventListener("pointerup", () => drawingActive = false);
drawing.addEventListener("pointercancel", () => drawingActive = false);

$("clearDrawing").onclick = () => {
  pen.clearRect(0, 0, drawing.width, drawing.height);
};

// -------- CÂMERA --------

$("cameraBtn").onclick = connectDevices;

// -------- GRAVAÇÃO --------

$("recordBtn").onclick = async () => {
  if (recordingPreparing || recorder?.state === "recording") return;
  if (!canRecord()) {
    $("status").textContent = "Para gravar, aguarde as fontes e conecte câmera e microfone ativos. É necessário suporte a MediaRecorder e captureStream.";
    return;
  }

  recordingPreparing = true;
  refreshStudioControls();
  let output;
  let recordingFailed = false;
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    await audioContext.resume();

    if (!hasLiveTrack("video") || !hasLiveTrack("audio")) throw new Error("Dispositivo desconectado antes da gravação.");
    audioSource = audioContext.createMediaStreamSource(cameraStream);
    audioDestination = audioContext.createMediaStreamDestination();
    audioSource.connect(audioDestination);

    output = canvas.captureStream(30);

    audioDestination.stream.getAudioTracks().forEach(track => {
      output.addTrack(track);
    });

    const formats = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
      "video/mp4"
    ];

    const mimeType = formats.find(type =>
      MediaRecorder.isTypeSupported(type)
    );

    recorder = new MediaRecorder(
      output,
      mimeType ? { mimeType } : undefined
    );

    chunks = [];

    recorder.ondataavailable = event => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunks, {
        type: recorder.mimeType || "video/webm"
      });

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = recorder.mimeType.includes("mp4") ? "cambee-my-cover.mp4" : "cambee-my-cover.webm";
      link.click();

      setTimeout(() => URL.revokeObjectURL(url), 60000);

      output.getTracks().forEach(track => track.stop());
      audioSource.disconnect();
      audioContext.close();

      recordingPreparing = false;
      refreshStudioControls();
      $("stopBtn").disabled = true;
      $("status").textContent = (recordingFailed || recorder.interrupted) ? "Gravação interrompida; confira o arquivo parcial." : "Seu cover foi salvo! ♡";
    };

    recorder.onerror = event => {
      recordingFailed = true;
      console.error(event.error);
      $("status").textContent = "A gravação foi interrompida. Confira o arquivo antes de continuar.";
      if (recorder.state !== "inactive") recorder.stop();
    };
    recorder.start(1000);
    recordingPreparing = false;
    refreshStudioControls();
    $("recordBtn").disabled = true;
    $("stopBtn").disabled = false;
    $("status").textContent = "🔴 Gravando seu cover...";

  } catch (error) {
    console.error(error);
    $("status").textContent = "Erro ao iniciar a gravação.";
    if(output) output.getTracks().forEach(track => track.stop());
    if(audioSource) audioSource.disconnect();
    recordingPreparing = false;
    refreshStudioControls();
    if (audioContext && audioContext.state !== "closed") {
      audioContext.close();
    }
  }
};

$("stopBtn").onclick = () => {
  if (recorder && recorder.state !== "inactive") {
    recorder.stop();
  }

  $("stopBtn").disabled = true;
  $("status").textContent = "Preparando seu vídeo…";
};
// -------- DECORAÇÕES: coordenadas na cartela original (1152 × 2048) --------
// Ajuste cada retângulo aqui se a imagem original for substituída.
const spriteDefinitions = [
  ['Azul',40,70,225,225], ['Coração rosa',325,80,230,225],
  ['Flor vintage',600,80,220,235], ['Coração vermelho',855,85,220,215],
  ['Vermelho',45,325,225,225], ['Estrela dourada',335,320,245,250],
  ['Rosa',605,375,225,220], ['Estrela rosa',860,345,265,250],
  ['Verde costurado',45,595,225,220], ['Flor rosa',325,600,235,235],
  ['Flor vermelha',590,635,235,235], ['Glitter roxo',875,655,225,220],
  ['Coelho creme',50,880,215,290], ['Estrela creme',305,880,255,250],
  ['Lilás',590,915,235,235], ['Amarelo',870,920,235,235],
  ['Coração pink',10,1195,295,295], ['Espiral rosa',320,1190,230,230],
  ['Laranja',590,1185,235,245], ['Preto',860,1195,235,235],
  ['Azul costurado',40,1510,225,230], ['Flor branca',305,1470,255,245],
  ['Flor verde',585,1470,255,250], ['Estrela roxa',855,1470,270,255],
  ['Tecido vermelho',140,1745,235,235], ['Tartaruga',435,1720,210,280],
  ['Roxo',705,1745,235,235]
];
const sprites = [];
const decorations = [];
let selectedDecoration = null, decorationId = 0, dragDecoration = null;

function updateDecorationControls() {
  const select = $('decorationSelection');
  select.replaceChildren(new Option('Nenhuma', ''));
  decorations.forEach(d => select.add(new Option(`${d.id} · ${decorationTypes[d.type].label(d)}`, d.id)));
  select.value = selectedDecoration ? String(selectedDecoration.id) : '';
  ['decorationSize','decorationRotation','deleteDecoration'].forEach(id => $(id).disabled=!selectedDecoration);
  if (selectedDecoration) {
    $('decorationSize').value=selectedDecoration.size;
    $('decorationRotation').value=selectedDecoration.rotation;
  }
}

// Cada tipo define sua camada, geometria e renderização. Manipulação é compartilhada.
const decorationTypes = {
  button: {
    layer: 'background',
    label: d => spriteDefinitions[d.sprite][0],
    draw(d) {
      const sprite=sprites[d.sprite];
      if (!sprite) return;
      ctx.save(); ctx.translate(d.x,d.y); ctx.rotate(d.rotation*Math.PI/180);
      ctx.drawImage(sprite,-d.size/2,-decorationHeight(d)/2,d.size,decorationHeight(d));
      ctx.restore();
    },
    hit(d,p) {
      const a=-d.rotation*Math.PI/180, dx=p.x-d.x, dy=p.y-d.y;
      return Math.abs(dx*Math.cos(a)-dy*Math.sin(a))<=d.size/2 &&
        Math.abs(dx*Math.sin(a)+dy*Math.cos(a))<=decorationHeight(d)/2;
    }
  },
  mirror: {
    layer: 'foreground',
    label: () => 'Mirror Star',
    draw(d) {
      ctx.save();
      mirrorStarPath(d); ctx.clip();
      if (cameraStream && video.readyState>=2) {
        const box=cameraBox();
        // A máscara gira; a imagem permanece no sistema de coordenadas da câmera.
        drawWebcam(box.x,box.y,box.w,box.h,true,true);
      } else {
        ctx.fillStyle='#e9c9de'; ctx.fillRect(0,0,W,H);
        ctx.fillStyle='#78334d'; ctx.textAlign='center'; ctx.font='16px sans-serif';
        ctx.fillText('Ligue a câmera',d.x,d.y);
      }
      ctx.restore();
    },
    hit(d,p) { mirrorStarPath(d); return ctx.isPointInPath(p.x,p.y); }
  }
};
function decorationHeight(d) {
  const sprite=sprites[d.sprite];
  return d.type==='button' && sprite ? d.size*sprite.height/sprite.width : d.size;
}
function mirrorStarPath(d) { starPath(d.x,d.y,d.size/2,d.rotation*Math.PI/180); }
function addDecoration(type, properties = {}) {
  const box=cameraBox();
  const mirrorCount=decorations.filter(d=>d.type==='mirror').length;
  selectedDecoration={id:++decorationId,type,
    x:type==='mirror' ? box.x+box.w*(.3+(mirrorCount%3)*.2) : 85+(decorations.length%8)*110,
    y:type==='mirror' ? box.y+box.h*.48 : 65,
    size:type==='mirror' ? 230 : 95, rotation:0, ...properties};
  decorations.push(selectedDecoration); updateDecorationControls();
}
function drawDecorations(layer) {
  for (const d of decorations) {
    const type=decorationTypes[d.type];
    if (type.layer===layer) type.draw(d);
  }
}
$('decorationType').onchange=()=>{
  const mirror=$('decorationType').value==='mirror';
  $('mirrorPalette').hidden=!mirror;
  $('decorationPalette').hidden=mirror;
  $('assetStatus').hidden=mirror;
};
$('addMirrorStar').onclick=()=>addDecoration('mirror');

const sheet = new Image();
sheet.onload = () => {
  try {
    spriteDefinitions.forEach(([name,x,y,w,h],index) => {
      const tile=document.createElement('canvas'); tile.width=w; tile.height=h;
      const c=tile.getContext('2d', {willReadFrequently:true});
      c.drawImage(sheet,x,y,w,h,0,0,w,h);
      const pixels=c.getImageData(0,0,w,h), data=pixels.data;
      // Remove apenas o branco conectado às bordas: preserva brilho e costura.
      const visited=new Uint8Array(w*h), queue=new Int32Array(w*h); let head=0,tail=0;
      function enqueue(p) {
        if(visited[p]) return;
        visited[p]=1; const k=p*4;
        if(Math.min(data[k],data[k+1],data[k+2])<238) return;
        queue[tail++]=p;
      }
      for(let a=0;a<w;a++) {enqueue(a);enqueue((h-1)*w+a);}
      for(let b=0;b<h;b++) {enqueue(b*w);enqueue(b*w+w-1);}
      while(head<tail) {
        const p=queue[head++]; data[p*4+3]=0;
        if(p%w) enqueue(p-1); if(p%w<w-1) enqueue(p+1);
        if(p>=w) enqueue(p-w); if(p<w*(h-1)) enqueue(p+w);
      }
      c.putImageData(pixels,0,0); sprites[index]=tile;
      const button=document.createElement('button'); button.type='button'; button.title=name;
      button.setAttribute('aria-label',`Adicionar botão ${name}`);
      button.append(tile);
      button.onclick=()=>addDecoration('button',{sprite:index});
      $('decorationPalette').append(button);
    });
    $('assetStatus').textContent='27 botões disponíveis';
  } catch(error) {
    console.error(error);
    $('assetStatus').textContent='Abra por um servidor local (localhost) para carregar os recortes.';
  }
};
sheet.onerror=()=> $('assetStatus').textContent='Não foi possível carregar assets/download.png.';
sheet.src='assets/download.png';

$('decorationSelection').onchange=()=>{
  selectedDecoration=decorations.find(d=>d.id===+$('decorationSelection').value)||null;
  updateDecorationControls();
};
$('decorationSize').oninput=()=>{if(selectedDecoration) selectedDecoration.size=+$('decorationSize').value;};
$('decorationRotation').oninput=()=>{if(selectedDecoration) selectedDecoration.rotation=+$('decorationRotation').value;};
$('deleteDecoration').onclick=()=>{
  if(selectedDecoration) decorations.splice(decorations.indexOf(selectedDecoration),1);
  selectedDecoration=null; dragDecoration=null; updateDecorationControls();
};
function stagePoint(event) {
  const rect=canvas.getBoundingClientRect();
  return {x:(event.clientX-rect.left)*W/rect.width,y:(event.clientY-rect.top)*H/rect.height};
}
canvas.addEventListener('pointerdown',event=>{
  const p=stagePoint(event);
  const box=cameraBox(); makeShape($('shape').value,box.x,box.y,box.w,box.h);
  const overCamera=ctx.isPointInPath(p.x,p.y,'evenodd');
  // Seleção na ordem inversa do desenho: estrelas são arrastáveis sobre a câmera.
  for (const layer of ['foreground','background']) {
    if (layer==='background' && overCamera) continue;
    for(let i=decorations.length-1;i>=0;i--) {
      const d=decorations[i], type=decorationTypes[d.type];
      if(type.layer===layer && type.hit(d,p)) {
        selectedDecoration=d; dragDecoration={dx:p.x-d.x,dy:p.y-d.y};
        updateDecorationControls(); canvas.setPointerCapture(event.pointerId); return;
      }
    }
  }
  selectedDecoration=null; updateDecorationControls();
});
canvas.addEventListener('pointermove',event=>{
  if(!dragDecoration || !selectedDecoration) return;
  const p=stagePoint(event);
  selectedDecoration.x=Math.max(0,Math.min(W,p.x-dragDecoration.dx));
  selectedDecoration.y=Math.max(0,Math.min(H,p.y-dragDecoration.dy));
});
['pointerup','pointercancel','lostpointercapture'].forEach(type=>canvas.addEventListener(type,()=>dragDecoration=null));
$('centerCamera').onclick=()=>{$('cameraX').value=50;$('cameraY').value=50;};
['showLyrics','showChords'].forEach(id=>$(id).addEventListener('change',()=>{$('cameraX').value=50;$('cameraY').value=50;}));
initializeStudio();
render();
