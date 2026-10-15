'use strict';
const {app,BrowserWindow,Menu,protocol,session,dialog}=require('electron');
const path=require('node:path');
const {serveAsset}=require('./assets.cjs');

protocol.registerSchemesAsPrivileged([{scheme:'recorta',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);
app.setName('Recorta Planta');
app.setAppUserModelId('com.recortaplanta.desktop');
let mainWindow;
const isSelfTest=!app.isPackaged&&app.commandLine.hasSwitch('self-test');
const hasLock=isSelfTest||app.requestSingleInstanceLock();
if(!hasLock)app.quit();
else{
  app.on('second-instance',()=>{if(mainWindow){if(mainWindow.isMinimized())mainWindow.restore();mainWindow.show();mainWindow.focus();}});
  app.whenReady().then(async()=>{
    const assetRoot=path.join(app.getAppPath(),'app','web');
    protocol.handle('recorta',request=>serveAsset(request,assetRoot));
    session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    session.defaultSession.setPermissionCheckHandler(()=>false);
    session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(_details,callback)=>callback({cancel:true}));
    session.defaultSession.on('will-download',(event,item)=>{
      if(!item.getURL().startsWith('blob:recorta://app/')){event.preventDefault();return;}
      const file=path.basename(item.getFilename()).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,180)||'planta.pdf';
      item.setSaveDialogOptions({title:'Salvar planta recortada',defaultPath:path.join(app.getPath('downloads'),file),filters:[{name:'Documento PDF',extensions:['pdf']}]});
      item.on('updated',()=>{if(mainWindow&&!mainWindow.isDestroyed()){const total=item.getTotalBytes();mainWindow.setProgressBar(total>0?item.getReceivedBytes()/total:2);}});
      item.once('done',(_e,state)=>{if(mainWindow&&!mainWindow.isDestroyed()){mainWindow.setProgressBar(-1);if(state==='interrupted')dialog.showMessageBox(mainWindow,{type:'error',title:'Não foi possível salvar',message:'O arquivo não foi salvo. Tente baixar a planta novamente e escolha uma pasta disponível.'});}});
    });
    mainWindow=new BrowserWindow({
      title:'Recorta Planta',width:1380,height:970,minWidth:720,minHeight:600,backgroundColor:'#f5f4ef',
      icon:path.join(assetRoot,'icon-512.png'),show:false,
      webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false,spellcheck:false,offscreen:isSelfTest}
    });
    mainWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    mainWindow.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith('recorta://app/'))event.preventDefault();});
    mainWindow.webContents.on('will-attach-webview',event=>event.preventDefault());
    mainWindow.webContents.on('did-fail-load',(_event,code)=>{if(code!==-3&&!isSelfTest)dialog.showMessageBox(mainWindow,{type:'error',title:'Não foi possível abrir o aplicativo',message:'Os arquivos do aplicativo não puderam ser carregados. Baixe uma nova cópia do Recorta Planta e tente novamente.'});});
    mainWindow.once('ready-to-show',()=>{if(!isSelfTest)mainWindow.show();});
    mainWindow.on('closed',()=>{mainWindow=null;});
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {label:'Arquivo',submenu:[
        {label:'Abrir PDF…',accelerator:'CmdOrCtrl+O',click:()=>mainWindow?.webContents.executeJavaScript("if(!document.body.classList.contains('busy'))document.getElementById('fileInput')?.click()",true)},
        {type:'separator'},{label:'Sair',role:'quit'}
      ]},
      {label:'Editar',submenu:[{label:'Desfazer',role:'undo'},{label:'Refazer',role:'redo'},{type:'separator'},{label:'Recortar',role:'cut'},{label:'Copiar',role:'copy'},{label:'Colar',role:'paste'},{label:'Selecionar tudo',role:'selectAll'}]},
      {label:'Exibir',submenu:[{label:'Tela cheia',role:'togglefullscreen'},{label:'Recarregar aplicativo',role:'reload'}]},
      {label:'Ajuda',submenu:[{label:'Como usar',click:()=>dialog.showMessageBox(mainWindow,{type:'info',title:'Como usar o Recorta Planta',message:'1. Clique em Selecionar PDF.\n2. Confira a planta identificada e ajuste os cantos se necessário.\n3. Clique em Baixar planta em PDF e escolha onde salvar.',detail:'PDFs escaneados são lidos automaticamente quando não há texto suficiente. Para selecionar outra área, use Desenhar nova área. O processamento acontece no computador, sem enviar seus PDFs para a internet.'})},{label:'Sobre o Recorta Planta',click:()=>dialog.showMessageBox(mainWindow,{type:'info',title:'Recorta Planta',message:`Recorta Planta ${app.getVersion()}`,detail:'Aplicativo para Windows. Identifica títulos de plantas baixas, sugere o recorte e permite ajustar a seleção. Confira as medidas e o enquadramento antes de usar o arquivo gerado.'})}]}
    ]));
    await mainWindow.loadURL('recorta://app/');
    if(isSelfTest){
      try{await require('../tests/native-smoke.cjs').run(mainWindow);app.exit(0);}
      catch(error){console.error('NATIVE_SMOKE_FAILED',error);app.exit(1);}
    }
  }).catch(error=>{console.error(error);if(!isSelfTest)dialog.showErrorBox('Recorta Planta','Não foi possível iniciar o aplicativo. Baixe uma nova cópia e tente novamente.');app.exit(1);});
  app.on('window-all-closed',()=>app.quit());
}
