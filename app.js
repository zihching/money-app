import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { 
    getFirestore, collection, doc, addDoc, deleteDoc, updateDoc, 
    onSnapshot, query, orderBy, enableIndexedDbPersistence, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- 1. 初始化全域變數 (把箱子放到最上面，保證不報錯) ---
window.appState = { 
    records: [], 
    customers: [], 
    pending: [], 
    currentCollector: '子晴', 
    editingCustomerId: null, 
    currentServiceCategory: 'stairs', 
    currentPendingAction: null, 
    selectedMonthsSet: new Set(), 
    currentBaseAmount: 0,
    pickerYear: 114, 
    modalPickerYear: 114,
    reportYear: 114, 
    reportCategory: 'all', // 預設顯示全部
    pendingMonthTargetId: null,
    currentView: 'entry'
};

// --- 2. Firebase 設定 ---
const firebaseConfig = {
    apiKey: "AIzaSyDFUGYOobmVxYFQMBYz1iQ4z1HIrdbTi8Q",
    authDomain: "travel-55c4b.firebaseapp.com",
    databaseURL: "https://travel-55c4b-default-rtdb.firebaseio.com",
    projectId: "travel-55c4b",
    storageBucket: "travel-55c4b.firebasestorage.app",
    messagingSenderId: "925227625640",
    appId: "1:925227625640:web:3dc6a2e45735ceb7f8a69d",
    measurementId: "G-6W8NY3EBZF"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const APP_ID = 'cleaning-app-v1'; 
let currentUser = null;

// 嘗試啟用離線緩存 (提升速度)
enableIndexedDbPersistence(db).catch((err) => {
    console.log("Persistence disabled:", err.code);
});

// --- 3. 登入與監聽 ---
const initAuth = async () => {
    if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        try { await signInWithCustomToken(auth, __initial_auth_token); } 
        catch (e) { await signInAnonymously(auth); }
    } else { await signInAnonymously(auth); }
};
initAuth();

onAuthStateChanged(auth, (user) => {
    const loader = document.getElementById('loading-overlay');
    if (user) {
        currentUser = user;
        const uidDisp = document.getElementById('userIdDisplay');
        if(uidDisp) uidDisp.innerText = `...${user.uid.slice(-4)}`;
        setupListeners();
        if(loader) loader.style.display = 'none';
    }
});

function setupListeners() {
    const recordsRef = collection(db, 'artifacts', APP_ID, 'public', 'data', 'records');
    const customersRef = collection(db, 'artifacts', APP_ID, 'public', 'data', 'customers');
    const pendingRef = collection(db, 'artifacts', APP_ID, 'public', 'data', 'pending');

    const qRec = query(recordsRef, orderBy('date', 'desc')); 
    onSnapshot(qRec, (snapshot) => {
        let recs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // 二次排序：日期 > 建立時間
        recs.sort((a, b) => {
            if (a.date > b.date) return -1;
            if (a.date < b.date) return 1;
            const tA = a.createdAt?.seconds || 0;
            const tB = b.createdAt?.seconds || 0;
            return tB - tA; 
        });
        window.appState.records = recs;
        
        // 更新畫面
        if(window.appState.currentView === 'entry') window.renderRecords();
        if(window.appState.currentView === 'settle') window.updateSummary();
        if(window.appState.currentView === 'report') window.renderYearlyReport();
        if(window.appState.currentView === 'settings') window.renderCustomerSettings();
        
        // 檢查是否需要更新金額提示
        const addr = document.getElementById('inputAddress');
        if(addr && addr.value) window.checkPaidStatus(addr.value);
    });

    const qCust = query(customersRef, orderBy('createdAt', 'desc'));
    onSnapshot(qCust, (snapshot) => {
        window.appState.customers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if(window.appState.currentView === 'settings') window.renderCustomerSettings();
        if(!document.getElementById('customerModal').classList.contains('hidden')) {
            window.renderCustomerSelect();
        }
        if(window.appState.currentView === 'report') window.renderYearlyReport();
    });

    const qPending = query(pendingRef, orderBy('createdAt', 'desc'));
    onSnapshot(qPending, (snapshot) => {
        window.appState.pending = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        window.renderPendingList();
    });
}

// --- 4. 視窗與 UI 切換功能 (Window Functions) ---

// 切換報表分類 (這就是你按了沒反應的那個功能)
window.setReportCategory = function(cat) {
    window.appState.reportCategory = cat;
    
    // 更新按鈕樣式
    const btns = { 'all': 'rep-cat-all', 'stairs': 'rep-cat-stairs', 'tank': 'rep-cat-tank' };
    Object.values(btns).forEach(id => {
        const el = document.getElementById(id);
        if(el) el.className = "flex-1 py-1.5 rounded-md text-sm font-bold text-gray-400 hover:bg-white hover:shadow-sm transition-all border border-transparent";
    });
    
    const active = document.getElementById(btns[cat]);
    if(active) active.className = "flex-1 py-1.5 rounded-md text-sm font-bold bg-white text-gray-800 shadow-sm transition-all border border-gray-200";
    
    window.renderYearlyReport();
};

window.toggleView = function(viewName) {
    window.appState.currentView = viewName;
    ['entry', 'settle', 'settings', 'report'].forEach(v => {
        document.getElementById(`view-${v}`).classList.add('hidden');
        const btn = document.getElementById(`nav-${v}`);
        if(btn) {
            btn.classList.remove('text-emerald-600'); 
            btn.classList.add('text-gray-400');
            btn.querySelector('span').className = 'text-[10px] font-medium';
        }
    });
    document.getElementById(`view-${viewName}`).classList.remove('hidden');
    const active = document.getElementById(`nav-${viewName}`);
    if(active) {
        active.classList.remove('text-gray-400'); 
        active.classList.add('text-emerald-600');
        active.querySelector('span').className = 'text-[10px] font-bold';
    }
    window.scrollTo(0,0);
    
    // 切換時刷新資料
    if(viewName === 'report') window.renderYearlyReport();
    if(viewName === 'settle') window.updateSummary();
    if(viewName === 'settings') window.renderCustomerSettings();
    if(viewName === 'entry') {
        window.renderRecords();
        window.renderPendingList();
    }
};

// --- 5. 資料庫寫入功能 ---

window.addRecord = async function() {
    if(!currentUser) { window.showToast("尚未連線"); return; }
    const newRecord = getFormData();
    if (!newRecord) return;
    try {
        await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', 'records'), newRecord);
        clearFormData();
        window.showToast("✅ 已收款");
    } catch (e) { console.error(e); window.showToast("❌ 儲存失敗"); }
};

window.addToPending = async function() {
    if(!currentUser) { window.showToast("尚未連線"); return; }
    const newItem = getFormData();
    if (!newItem) return;
    if(newItem.status === 'completed') newItem.status = 'completed'; 
    try {
        await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', 'pending'), newItem);
        clearFormData();
        window.showToast("📋 已加入清單");
    } catch (e) { console.error(e); window.showToast("❌ 加入失敗"); }
};

window.completePending = async function(docId, data) {
    if(!currentUser) return;
    const record = {
        ...data,
        collector: window.appState.currentCollector,
        createdAt: serverTimestamp()
    };
    try {
        await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', 'records'), record);
        await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'pending', docId));
        window.showToast("✅ 完成收款");
    } catch(e) { console.error(e); window.showToast("操作失敗"); }
};

window.deleteRecord = async function(docId) {
    if(!currentUser) return;
    if(confirm("確定刪除此紀錄？")) {
        await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'records', docId));
        window.showToast("🗑️ 已刪除");
    }
};

window.updateRecordStatus = async function(docId, newStatus) {
     if(!currentUser) return;
     try {
         await updateDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'records', docId), { status: newStatus });
         window.showToast("狀態已更新");
     } catch(e) { window.showToast("更新失敗"); }
};

window.deletePending = async function(docId) {
    if(!currentUser) return;
    if(confirm("從清單移除？")) {
        await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'pending', docId));
    }
};

// --- 6. 報表邏輯 (Year Report) ---

window.changeReportYear = function(delta) { 
    window.appState.reportYear += delta; 
    document.getElementById('reportYearDisplay').innerText = `${window.appState.reportYear}年`; 
    window.renderYearlyReport(); 
};

window.renderYearlyReport = function() { 
    const container = document.getElementById('yearReportGrid'); 
    if(!container) return;
    container.innerHTML = ''; 
    const year = window.appState.reportYear; 
    const current = window.appState.currentCollector; 
    const catFilter = window.appState.reportCategory || 'all'; 

    // 1. 篩選紀錄
    let records = window.appState.records.filter(r => {
        const rCol = r.collector || '子晴';
        if(rCol !== current) return false;
        // 分類過濾 (預設樓梯)
        const rCat = r.category || 'stairs';
        if(catFilter !== 'all' && rCat !== catFilter) return false;
        return true;
    });

    // 2. 篩選客戶 (把沒消費的也列出來檢查)
    const custs = window.appState.customers.filter(c => {
        if(!((c.collector === current) || (!c.collector && current === '子晴'))) return false;
        const cCat = c.category || 'stairs';
        if(catFilter !== 'all' && cCat !== catFilter) return false;
        return true;
    });

    const addressSet = new Set();
    custs.forEach(c => addressSet.add(c.address)); 
    records.forEach(r => addressSet.add(r.address)); 

    const addresses = Array.from(addressSet).sort(); 

    if(addresses.length === 0) { 
        container.innerHTML = '<div class="text-center text-gray-400 py-10">尚無資料</div>'; 
        return; 
    } 

    addresses.forEach(addr => { 
        const monthInfo = Array(13).fill(null); 
        const addrRecords = window.appState.records.filter(r => r.address === addr); 
        
        addrRecords.forEach(r => { 
            // 這裡也要過濾，避免水塔的錢跑到樓梯的表上
            const rCat = r.category || 'stairs';
            if(catFilter !== 'all' && rCat !== catFilter) return;

            const d = new Date(r.date); 
            const collectDate = (d instanceof Date && !isNaN(d)) ? `${d.getMonth()+1}/${d.getDate()}` : '??'; 
            
            if (r.months && r.months.includes(`${year}年`)) { 
                const parts = r.months.match(new RegExp(`${year}年\\s*([0-9,]+)`)); 
                if(parts && parts[1]) { 
                    const paidMonths = parts[1].split(',').map(Number); 
                    paidMonths.forEach(m => { 
                        if(m >= 1 && m <= 12) { 
                            let status = 'paid'; 
                            if(r.status === 'no_payment' || r.status === 'no_receipt') { status = 'warning'; } 
                            monthInfo[m] = { status: status, date: collectDate, id: r.id, amount: r.amount, fullDate: r.date }; 
                        } 
                    }); 
                } 
            } 
        }); 

        const card = document.createElement('div'); 
        card.className = 'bg-white p-3 rounded-lg border border-gray-100 shadow-sm'; 
        
        let monthHtml = ''; 
        for(let m=1; m<=12; m++) { 
            const info = monthInfo[m]; 
            let className = 'year-dot flex flex-col justify-center leading-none'; 
            let content = m; 
            let onclick = `openReportAction('${addr}', ${year}, ${m}, null)`; 
            if(info) { 
                onclick = `openReportAction('${addr}', ${year}, ${m}, '${info.id}', '${info.fullDate}', ${info.amount})`; 
                if(info.status === 'paid') { 
                    className += ' paid'; 
                    content = `<span class="text-[8px] opacity-75">${m}月</span><span class="text-[10px]">${info.date}</span>`; 
                } else if (info.status === 'warning') { 
                    className += ' warning'; 
                    content = `<span class="text-[8px] opacity-75">${m}月</span><span class="text-[10px]">${info.date}</span>`; 
                } 
            } else { 
                content = `<span class="text-xs">${m}</span>`; 
            } 
            monthHtml += `<div class="${className}" style="height: 36px;" onclick="${onclick}">${content}</div>`; 
        } 
        
        card.innerHTML = ` <div class="font-bold text-gray-700 mb-2 border-b pb-1 text-sm flex justify-between"> <span>${addr}</span> <span class="text-xs text-gray-300 font-normal">#${year}</span> </div> <div class="grid grid-cols-6 gap-2"> ${monthHtml} </div> `; 
        container.appendChild(card); 
    }); 
};

window.openReportAction = function(address, year, month, recordId, date, amount) { 
    const title = document.getElementById('reportActionTitle'); 
    const content = document.getElementById('reportActionContent'); 
    
    if(recordId) { 
        title.innerText = `編輯紀錄：${address} (${month}月)`; 
        content.innerHTML = ` 
            <div> 
                <label class="block text-xs text-gray-500 mb-1">收款日期</label> 
                <input type="date" id="reportEditDate" value="${date}" class="w-full p-2 border rounded"> 
            </div> 
            <div> 
                <label class="block text-xs text-gray-500 mb-1">金額</label> 
                <input type="number" id="reportEditAmount" value="${amount}" class="w-full p-2 border rounded"> 
            </div> 
            <div class="grid grid-cols-2 gap-2 mt-4"> 
                <button onclick="deleteReportRecord('${recordId}')" class="py-2 bg-red-100 text-red-600 rounded-lg font-bold">刪除紀錄</button> 
                <button onclick="updateReportRecord('${recordId}', document.getElementById('reportEditDate').value, document.getElementById('reportEditAmount').value)" class="py-2 bg-blue-600 text-white rounded-lg font-bold">儲存修改</button> 
            </div> `; 
    } else { 
        const cust = window.appState.customers.find(c => c.address === address); 
        const defAmount = cust ? cust.amount : ''; 
        const today = new Date().toISOString().split('T')[0]; 
        title.innerText = `補登紀錄：${address} (${month}月)`; 
        content.innerHTML = ` 
            <div class="text-sm text-gray-500 mb-2">確定要補登 <strong>${year}年${month}月</strong> 的收款嗎？</div> 
            <div> 
                <label class="block text-xs text-gray-500 mb-1">收款日期</label> 
                <input type="date" id="reportAddDate" value="${today}" class="w-full p-2 border rounded"> 
            </div> 
            <div> 
                <label class="block text-xs text-gray-500 mb-1">金額</label> 
                <input type="number" id="reportAddAmount" value="${defAmount}" placeholder="輸入金額" class="w-full p-2 border rounded"> 
            </div> 
            <button onclick="addReportRecord('${address}', ${year}, ${month}, document.getElementById('reportAddAmount').value)" class="w-full py-3 bg-emerald-500 text-white rounded-lg font-bold mt-4">確認補登</button> `; 
    } 
    document.getElementById('reportActionModal').classList.remove('hidden'); 
};

window.closeReportActionModal = function(e) { if(e && e.target !== e.currentTarget) return; document.getElementById('reportActionModal').classList.add('hidden'); };
window.addReportRecord = async function(address, year, month, amount) { if(!currentUser) return; const record = { date: new Date().toISOString().split('T')[0], address: address, amount: amount, floor: '', months: `${year}年 ${month}月`, note: '補登', type: 'cash', category: 'stairs', collector: window.appState.currentCollector, status: 'completed', createdAt: serverTimestamp() }; const cust = window.appState.customers.find(c => c.address === address); if(cust) { if(cust.amount) record.amount = cust.amount; if(cust.category) record.category = cust.category; if(cust.floor) record.floor = cust.floor; } try { await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', 'records'), record); window.closeReportActionModal(null); window.showToast("✅ 已補登"); } catch(e) { window.showToast("補登失敗"); } };
window.updateReportRecord = async function(docId, date, amount) { if(!currentUser) return; try { await updateDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'records', docId), { date: date, amount: parseInt(amount) }); window.closeReportActionModal(null); window.showToast("已更新"); } catch(e) { window.showToast("更新失敗"); } };
window.deleteReportRecord = async function(docId) { if(!currentUser) return; if(confirm("確定刪除？這月份將變回未收狀態")) { await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'records', docId)); window.closeReportActionModal(null); window.showToast("🗑️ 已刪除"); } };

// --- 7. 表單與其他輔助功能 ---

function getFormData() {
    const dateInput = document.getElementById('inputDate').value;
    const serviceDate = document.getElementById('inputServiceDate').value;
    
    const address = document.getElementById('inputAddress').value.trim();
    const floor = document.getElementById('inputFloor').value.trim();
    const amount = parseInt(document.getElementById('inputAmount').value);
    const type = document.getElementById('inputType').value;
    const categoryElement = document.getElementById('inputServiceType');
    const category = categoryElement ? categoryElement.value : 'stairs';
    const collector = window.appState.currentCollector; 
    const note = document.getElementById('inputNote').value.trim();
    const months = document.getElementById('selectedMonths').value;
    const status = document.getElementById('inputStatus').value || 'completed';

    if (!address) { window.showToast("⚠️ 請輸入地址！"); document.getElementById('inputAddress').focus(); return null; }
    if (isNaN(amount)) { window.showToast("⚠️ 請輸入金額！"); document.getElementById('inputAmount').focus(); return null; }

    return { 
        date: dateInput, 
        serviceDate: serviceDate,
        address, floor, months, amount, type, category, collector, note, status, createdAt: serverTimestamp() 
    };
}

function clearFormData() {
    document.getElementById('inputAddress').value = '';
    document.getElementById('inputFloor').value = '';
    document.getElementById('inputAmount').value = '';
    document.getElementById('inputNote').value = '';
    window.resetMonthPicker();
    window.setStatus('completed'); 
}

window.renderPendingList = function() {
    const list = document.getElementById('pendingList');
    const container = document.getElementById('pendingContainer');
    const current = window.appState.currentCollector;
    const items = window.appState.pending.filter(i => 
        (i.collector === current) || (!i.collector && current === '子晴')
    );
    
    if (items.length === 0) { container.classList.add('hidden'); return; }
    container.classList.remove('hidden');
    document.getElementById('pendingCount').innerText = items.length;
    list.innerHTML = '';

    items.forEach(item => {
        const floorId = `p-floor-${item.id}`;
        const monthsId = `p-months-${item.id}`;
        const noteId = `p-note-${item.id}`;
        const typeId = `p-type-${item.id}`;
        const catIcon = item.category === 'tank' ? '<span class="text-cyan-600">💧</span>' : '<span class="text-orange-600">🪜</span>';
        
        let sTag = '';
        if(item.serviceDate) {
            sTag = `<span class="text-xs bg-cyan-100 text-cyan-700 px-1 rounded ml-1 font-bold">洗:${item.serviceDate.slice(5)}</span>`;
        }

        const div = document.createElement('div');
        div.className = 'bg-white p-3 rounded-xl border border-gray-200 shadow-sm relative';
        div.innerHTML = `
            <div class="flex justify-between items-start mb-2">
                <div class="flex items-center gap-2">
                    <div class="text-xl">${catIcon}</div>
                    <div>
                        <div class="font-bold text-lg text-gray-800 flex items-center">${item.address} ${sTag}</div>
                    </div>
                </div>
                <div class="font-bold text-emerald-600 text-lg">$${item.amount}</div>
            </div>
            <div class="space-y-2">
                <div class="flex gap-2">
                    <input id="${monthsId}" value="${item.months || ''}" readonly onclick="openPendingMonthPicker('${item.id}', '${item.months||''}')" placeholder="選擇月份" class="bg-blue-50 border border-blue-200 rounded p-2 text-sm w-1/2 text-center text-blue-700 font-bold cursor-pointer">
                    <input id="${floorId}" value="${item.floor || ''}" placeholder="樓層/戶號" class="bg-gray-50 border rounded p-2 text-sm w-1/2 text-center font-medium">
                </div>
                <div class="flex gap-2 items-center">
                    <select id="${typeId}" class="bg-gray-50 border rounded p-2 text-sm w-20">
                        <option value="cash" ${item.type === 'cash' ? 'selected' : ''}>現金</option>
                        <option value="transfer" ${item.type === 'transfer' ? 'selected' : ''}>匯款</option>
                        <option value="linepay" ${item.type === 'linepay' ? 'selected' : ''}>LinePay</option>
                        <option value="dad" ${item.type === 'dad' ? 'selected' : ''}>匯給爸爸</option>
                    </select>
                    <input id="${noteId}" value="${item.note || ''}" placeholder="備註..." class="bg-gray-50 border rounded p-2 text-sm flex-1">
                    <button onclick="openConfirmCollectionModal('${item.id}', ${item.amount}, '${item.address}', '${item.category || 'stairs'}', '${item.serviceDate || ''}')" class="bg-green-500 text-white w-10 h-10 rounded-full shadow flex items-center justify-center active:scale-90 transition-transform flex-shrink-0">
                        <i class="fa-solid fa-check"></i>
                    </button>
                </div>
            </div>
            <button onclick="deletePending('${item.id}')" class="absolute top-2 right-2 text-gray-300 hover:text-red-400 p-1"><i class="fa-solid fa-times"></i></button>
        `;
        list.appendChild(div);
    });
};

window.renderRecords = function() {
    const list = document.getElementById('recordList');
    const records = window.appState.records.filter(r => {
        const rCol = r.collector || '子晴'; 
        return rCol === window.appState.currentCollector;
    });
    list.innerHTML = '';
    document.getElementById('recordCount').innerText = records.length;

    if (records.length === 0) {
        list.innerHTML = `<div class="text-center text-gray-400 py-12 opacity-60"><i class="fa-solid fa-clipboard-list text-4xl mb-3"></i><p>尚無 ${window.appState.currentCollector} 的紀錄</p></div>`;
        return;
    }

    records.forEach(record => {
        let tagClass = 'tag-cash';
        let tagText = '現金';
        if(record.type === 'transfer') { tagClass = 'tag-transfer'; tagText = '匯款'; }
        else if(record.type === 'linepay') { tagClass = 'tag-linepay'; tagText = 'LinePay'; }
        else if(record.type === 'dad') { tagClass = 'tag-dad'; tagText = '已匯給爸爸'; }

        let noteHtml = record.note ? `<div class="text-sm mt-2 p-2 rounded-lg border border-gray-100 bg-gray-50 text-gray-600 flex items-center gap-2"><i class="fa-regular fa-comment-dots"></i> <span>${record.note}</span></div>` : '';
        const dateObj = new Date(record.date);
        const displayDate = `${dateObj.getMonth()+1}/${dateObj.getDate()}`;
        
        let sTag = '';
        if(record.category === 'tank') sTag = `<span class="text-xs font-bold px-2 py-0.5 rounded-full tag-tank flex items-center gap-1">💧 洗水塔</span>`;
        else sTag = `<span class="text-xs font-bold px-2 py-0.5 rounded-full tag-stairs flex items-center gap-1">🪜 洗樓梯</span>`;

        let serviceTag = '';
        if(record.serviceDate) {
            const sDate = new Date(record.serviceDate);
            const sDateStr = `${sDate.getMonth()+1}/${sDate.getDate()}`;
            serviceTag = `<span class="text-xs font-bold px-2 py-0.5 rounded-full bg-cyan-100 text-cyan-700 flex items-center gap-1 ml-1"><i class="fa-solid fa-soap"></i> 洗:${sDateStr}</span>`;
        }

        let statusHtml = '';
        if(record.status === 'no_receipt') {
            statusHtml = `<div class="mt-2 bg-red-50 p-2 rounded-lg border border-red-200 flex justify-between items-center"><span class="text-xs font-bold text-red-600"><i class="fa-solid fa-triangle-exclamation"></i> 待給收據</span><button onclick="updateRecordStatus('${record.id}', 'completed')" class="px-3 py-1 bg-red-500 text-white text-xs rounded-full shadow active:scale-95">已補單</button></div>`;
        } else if(record.status === 'no_payment') {
            statusHtml = `<div class="mt-2 bg-orange-50 p-2 rounded-lg border border-orange-200 flex justify-between items-center"><span class="text-xs font-bold text-orange-600"><i class="fa-solid fa-hourglass-half"></i> 待確認匯款</span><button onclick="updateRecordStatus('${record.id}', 'completed')" class="px-3 py-1 bg-orange-500 text-white text-xs rounded-full shadow active:scale-95">款項已入</button></div>`;
        }

        const item = document.createElement('div');
        item.className = 'card p-4 relative border-l-4 ' + (record.type === 'cash' ? 'border-gray-400' : 'border-gray-300');
        item.innerHTML = `
            <div class="flex justify-between items-start">
                <div class="flex-1 mr-2">
                    <div class="flex items-center gap-2 mb-1 flex-wrap">
                        <span class="text-xs font-bold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">${displayDate}</span>
                        ${sTag}
                        ${serviceTag}
                        <span class="text-xs font-bold px-2 py-0.5 rounded-full ${tagClass} flex items-center gap-1">${tagText}</span>
                    </div>
                    <div class="text-xl font-bold text-gray-800 leading-tight mb-1">${record.address} <span class="text-base font-normal text-gray-500 ml-1">${record.floor || ''}</span></div>
                    <div class="text-sm text-blue-600 font-bold bg-blue-50 inline-block px-2 py-0.5 rounded border border-blue-100"><i class="fa-regular fa-calendar-check mr-1"></i> ${record.months || '未填月份'}</div>
                </div>
                <div class="text-right"><div class="text-2xl font-bold font-mono text-gray-800">$${record.amount.toLocaleString()}</div></div>
            </div>
            ${statusHtml} ${noteHtml}
            <button onclick="deleteRecord('${record.id}')" class="absolute top-2 right-2 text-gray-200 hover:text-red-400 p-2"><i class="fa-solid fa-trash-can"></i></button>
        `;
        list.appendChild(item);
    });
};

window.openConfirmCollectionModal = function(id, amount, address, category, serviceDate) {
    const floor = document.getElementById(`p-floor-${id}`).value;
    const months = document.getElementById(`p-months-${id}`).value;
    const note = document.getElementById(`p-note-${id}`).value;
    const type = document.getElementById(`p-type-${id}`).value;

    window.appState.currentPendingAction = { id, amount, address, category, floor, months, note, type };
    document.getElementById('confirmModalAddress').innerText = address;
    document.getElementById('confirmModalMonths').value = months; 
    document.getElementById('confirmModalAmount').innerText = `$${amount}`;
    document.getElementById('confirmModalNote').value = note || '';
