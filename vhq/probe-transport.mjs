import {spawn} from 'node:child_process';
const mode=process.argv[2]||'path';
const prompt="'Reply only with VHQ_READY. Do not use tools or modify files.'";
const run='/home/zain/.opencode/bin/opencode run --model opencode/deepseek-v4.1-flash-free --format json '+prompt;
const commands={
 path:'printf "WSL_STARTED\\n"; /home/zain/.opencode/bin/opencode --version',
 baseline:'cd ~/vhq-pilot && printf "START_BASELINE\\n" >&2 && timeout --kill-after=5s 45s '+run,
 deny:'cd ~/vhq-pilot && printf "START_DENY\\n" >&2 && export OPENCODE_CONFIG_CONTENT=\'{"permission":"deny"}\' && timeout --kill-after=5s 45s '+run
};
if(!Object.hasOwn(commands,mode))throw Error('use path, baseline or deny');
const p=spawn('wsl.exe',['-d','Ubuntu-24.04','-e','bash','-ic',commands[mode]],{shell:false,stdio:['ignore','pipe','pipe']});
let bytes=0;
for(const [s,d] of [[p.stdout,process.stdout],[p.stderr,process.stderr]])s.on('data',b=>{bytes+=b.length; if(bytes<=65536)d.write(b);else p.kill();});
const timer=setTimeout(()=>{console.error('HOST_TIMEOUT');p.kill();},60000);
p.on('error',e=>{console.error(e.message);process.exitCode=1;});
p.on('close',code=>{clearTimeout(timer);console.log('EXIT',code,'BYTES',bytes);process.exitCode=code===0?0:1;});
