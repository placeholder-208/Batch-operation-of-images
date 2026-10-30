import { createWorkspacePersistence } from './workspace-persistence.js';

export function startWorkspaceSession(controllers) {
    const shell = document.querySelector('.shell');
    const label = document.createElement('span');
    label.className = 'save-status';
    label.setAttribute('role', 'status');
    label.title = '图片与工作进度保存在当前浏览器。清空工作区会同步删除保存的内容；清除网站数据或更换域名后无法恢复。';
    const tools = document.querySelector('.header-tools');
    const privacy = document.getElementById('privacyLabel');
    tools.prepend(label);
    if (privacy) label.after(privacy);
    const notice = document.createElement('p');
    notice.className = 'save-error';notice.hidden = true;notice.setAttribute('role', 'alert');
    document.querySelector('.tabs').after(notice);
    const modes = ['qr', 'barcode', 'mask', 'semantic', 'sam'];
    const page = {
        snapshot: () => ({ mode: modes.find(mode => document.getElementById(mode + 'Tab').getAttribute('aria-selected') === 'true') || 'qr',
            maskView: document.getElementById('sam-maskView')?.getAttribute('aria-selected') === 'true' }),
        restore(saved) {
            if (modes.includes(saved.mode)) document.getElementById(saved.mode + 'Tab').click();
            document.getElementById(saved.maskView ? 'sam-maskView' : 'sam-sourceView')?.click();
        }
    };
    let lastState='',lastSaved=null;
    const persistence = createWorkspacePersistence({ ...controllers, page }, error => {
        notice.hidden = false;
        notice.textContent = error?.name === 'QuotaExceededError'
            ? '浏览器存储空间不足，本次修改尚未保存。请先下载需要的结果，再清空不需要的工作区。'
            : '本地保存或恢复未完成：' + (error?.message || String(error));
    }, state => {
        label.dataset.state = state;
        label.textContent = { restoring: '正在恢复工作…', saving: '正在保存…', saved: '已保存到本机', error: '有修改未保存' }[state];
        if (state === 'saved') {
            notice.hidden = true;
            if(lastState==='saving'||lastState==='restoring')lastSaved=new Date();
            if(lastSaved){const time=lastSaved.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});label.textContent='已保存 '+time;label.title='已保存到本机 · '+lastSaved.toLocaleString('zh-CN')+'。清空批次会删除该批保存内容。';}
        }
        lastState=state;
    });
    document.addEventListener('workspace:change', () => persistence.schedule('page'));
    document.getElementById('samWorkspace').addEventListener('sam:viewchange', () => persistence.schedule('page'));
    document.addEventListener('visibilitychange', () => { if (document.hidden) void persistence.flush(); });
    window.addEventListener('pagehide', () => { void persistence.flush(); });
    window.addEventListener('beforeunload', event => {
        if (!persistence.isDirty()) return;
        void persistence.flush();event.preventDefault();event.returnValue = '';
    });
    // Prevent input from racing asynchronous restoration and replacing the queue.
    shell.inert = true;shell.setAttribute('aria-busy', 'true');
    void persistence.restore().then(() => {
        for(const id of ['normalWorkspace','barcodeWorkspace','maskWorkspace','semanticWorkspace','samWorkspace']){
            const root=document.getElementById(id),count=Number(root.dataset.total||0);if(!count)continue;
            const banner=document.createElement('div');banner.className='restored-banner';banner.setAttribute('role','status');
            const text=document.createElement('span');text.textContent='已恢复上次的 '+count+' 张图片及保存的结果。';
            const clear=document.createElement('button');clear.className='secondary';clear.type='button';clear.textContent='清空本批';clear.title='再次确认后删除本批图片和本机保存状态';clear.onclick=()=>{const target=root.querySelector('.stage-toolbar button[id$="Reset"],#resetImages,#sam-clearBatch');target?.click();clear.textContent=target?.textContent||'清空本批';};
            const close=document.createElement('button');close.className='secondary';close.type='button';close.textContent='关闭';close.onclick=()=>banner.remove();banner.append(text,clear,close);root.querySelector('.stage-toolbar').after(banner);
            root.addEventListener('studio:batchchange',event=>{if(!event.detail.total)banner.remove();});
        }
    }).finally(() => { shell.inert = false;shell.removeAttribute('aria-busy'); });
    return persistence;
}
