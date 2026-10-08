import { $, updateWorkspaceDescription } from './ui.js';
export function setupWorkspaceTabs(refresh) {
    const modes=['qr','barcode','mask','semantic'];
    const workspaces={qr:'normalWorkspace',barcode:'barcodeWorkspace',mask:'maskWorkspace',semantic:'semanticWorkspace'};
    for(const mode of modes) {
        const tab=$(mode+'Tab');tab.setAttribute('aria-controls',workspaces[mode]);
        $(workspaces[mode]).setAttribute('role','tabpanel');$(workspaces[mode]).setAttribute('aria-labelledby',mode+'Tab');
        tab.onclick=()=>{for(const name of modes){$(workspaces[name]).hidden=name!==mode;$(name+'Tab').setAttribute('aria-selected',String(name===mode));$(name+'Tab').tabIndex=name===mode?0:-1;}
            updateWorkspaceDescription(mode);refresh();};
        tab.addEventListener('keydown',event=>{
            if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();
            const index=modes.indexOf(mode),next=event.key==='Home'?0:event.key==='End'?modes.length-1:
                (index+(event.key==='ArrowRight'?1:modes.length-1))%modes.length;
            $(modes[next]+'Tab').click();$(modes[next]+'Tab').focus();
        });
    }
}
