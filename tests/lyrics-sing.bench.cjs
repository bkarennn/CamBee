// Measures local text alignment only, not microphone/network/transcription latency.
// node tests/lyrics-sing.bench.cjs [optional baseline JavaScript path]
const fs=require('node:fs');
const vm=require('node:vm');
const {performance}=require('node:perf_hooks');
const files=process.argv[2]?[process.argv[2],'lyrics-sing.js']:['lyrics-sing.js'];
for(const size of [79,1203]) {
  const lyrics=Array.from({length:size-3},(_,i)=>['vento','noite','caminho','estrelas','janela','cidade','chuva'][i%7]).join(' ')+' horizonte violeta amanhecer';
  for(const file of files) {
    const context=vm.createContext({lyrics});
    vm.runInContext(fs.readFileSync(file,'utf8'),context);
    const prepareStart=performance.now();
    vm.runInContext('globalThis.words=typeof prepareSingingLyrics==="function"?prepareSingingLyrics(lyrics).words:singTokens(lyrics)',context);
    const preparation=performance.now()-prepareStart;
    vm.runInContext('globalThis.inputs=["violeta amanhecer","horizonte violeta","vento noite caminho","janela cidade chuva"].map(singTokens);globalThis.runMatch=i=>matchSungWords(words,inputs[i%inputs.length],0)',context);
    const run=context.runMatch;
    const firstStart=performance.now();const first=run(0);const cold=performance.now()-firstStart;
    if(first.cursor!==size) throw new Error(`Failed to find final phrase in ${file}`);
    const times=[];
    for(let i=0;i<40;i++) {const start=performance.now();run(i);times.push(performance.now()-start);}
    times.sort((a,b)=>a-b);
    console.log(JSON.stringify({file,words:size,prepareMs:+preparation.toFixed(2),firstMatchMs:+cold.toFixed(2),medianMs:+times[20].toFixed(2),p95Ms:+times[38].toFixed(2)}));
  }
}
