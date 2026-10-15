const {spawn}=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const child=spawn(require('electron'),['.','--self-test','--disable-gpu'],{
  cwd:root,stdio:'inherit',env:{...process.env,RECORTA_SMOKE_REPORT:path.join(root,'test-results','native-smoke-report.json')}
});
const timer=setTimeout(()=>{child.kill();console.error('O teste da interface excedeu o tempo disponível.');process.exitCode=1;},180000);
require('node:fs').mkdirSync(path.join(root,'test-results'),{recursive:true});
child.on('error',error=>{clearTimeout(timer);console.error(error);process.exitCode=1;});
child.on('exit',code=>{clearTimeout(timer);process.exitCode=code===0?0:1;});
