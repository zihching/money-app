import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { 
    getFirestore, collection, doc, addDoc, deleteDoc, updateDoc, writeBatch,
    onSnapshot, query, orderBy, enableIndexedDbPersistence, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- 1. 初始化全域變數 ---
window.appState = { 
    records: [], customers: [], pending: [], 
    currentCollector: '子晴', 
    editingCustomerId: null, 
    currentServiceCategory: 'stairs', 
    currentPendingAction: null, 
    selectedMonthsSet: new Set(), 
    currentBaseAmount: 0,
    pickerYear: 114, 
    modalPickerYear: 114,
    reportYear: 114, 
    reportCategory: 'all', 
    pendingMonthTargetId: null,
    currentView: 'entry',
    reportBatchMonths: new Set(),
    tempModalSet: new Set(),
    deleteTargetId: null,
    deleteType: null
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

enableIndexedDbPersistence(db).catch((err) => { console.log("Persistence disabled:", err.code); });

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
        recs.sort((a, b) => {
            if (a.date > b.date) return -1;
            if (a.date < b.date) return 1;
            return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
        });
        window.appState.records = recs;
        refreshCurrentView();
    });

    const qCust = query(customersRef, orderBy('createdAt', 'desc'));
    onSnapshot(qCust, (snapshot) => {
        let custs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        custs.sort((a, b) => (a.order || 0) - (b.order || 0));
        window.appState.customers = custs;
        if(window.updateAddressSuggestions) window.updateAddressSuggestions(custs);
        refreshCurrentView();
    });

    const qPending = query(pendingRef, orderBy('createdAt', 'desc'));
    onSnapshot(qPending, (snapshot) => {
        window.appState.pending = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        window.renderPendingList();
    });
}

function refreshCurrentView() {
    if(window.appState.currentView === 'entry') { window.renderRecords(); window.renderPendingList(); }
    if(window.appState.currentView === 'settle') { window.updateSummary(); }
    if(window.appState.currentView === 'report') { window.renderYearlyReport(); }
    if(window.appState.currentView === 'settings') { window.renderCustomerSettings(); }
    if(!document.getElementById('customerModal').classList.contains('hidden')) { window.renderCustomerSelect(); }
    if(!document.getElementById('manageCustomerModal').classList.contains('hidden')) { window.renderManageCustomerList(); }
    
    const addr = document.getElementById('inputAddress');
    if(addr && addr.value) window.checkPaidStatus(addr.value);
}
// --- 4. 視窗與 UI 操作 (含排序與管理) ---

window.openManageCustomerModal = function() {
    window.renderManageCustomerList();
    document.getElementById('manageCustomerModal').classList.remove('hidden');
    const el = document.getElementById('manageCustomerList');
    if(window.sortableInstance) window.sortableInstance.destroy(); 
    window.sortableInstance = new Sortable(el, {
        handle: '.handle', filter: '.ignore-drag', preventOnFilter: false, 
        animation: 150, ghostClass: 'bg-blue-50', 
        onEnd: function (evt) { window.saveNewOrder(); },
    });
};

window.closeManageCustomerModal = function(e) {
    if(e && e.target !== e.currentTarget) return;
    document.getElementById('manageCustomerModal').classList.add('hidden');
};

window.renderManageCustomerList = function() {
    const list = document.getElementById('manageCustomerList');
    if(!list) return;
    const current = window.appState.currentCollector;
    const catFilter = window.appState.reportCategory || 'all'; 
    const custs = window.appState.customers.filter(c => {
        if(!((c.collector === current) || (!c.collector && current === '子晴'))) return false;
        const cCat = c.category || 'stairs';
        if(catFilter !== 'all' && cCat !== catFilter) return false;
        return true;
    });
    list.innerHTML = '';
    if(custs.length === 0) { list.innerHTML = '<div class="text-center text-gray-400 mt-4">無資料</div>'; return; }
    custs.forEach((c) => {
        const catIcon = (c.category || 'stairs') === 'tank' ? '💧' : '🪜';
        const dateTag = c.serviceDate ? `<span class="ml-2 text-[10px] bg-gray-100 px-1 rounded text-gray-500">${c.serviceDate.slice(5)}</span>` : '';
        const noteTag = c.note ? `<span class="ml-1 text-[10px] text-orange-500"><i class="fa-solid fa-note-sticky"></i> ${c.note}</span>` : '';
        const div = document.createElement('div');
        div.setAttribute('data-id', c.id);
        div.className = 'flex items-center justify-between p-3 bg-white border border-gray-100 mb-2 rounded-lg shadow-sm';
        div.innerHTML = `
            <div class="flex items-center gap-3 overflow-hidden">
                <div class="handle cursor-move p-2 touch-none"><i class="fa-solid fa-bars text-gray-400 text-lg"></i></div>
                <div class="flex-1">
                    <div class="font-bold text-gray-800 text-sm truncate flex items-center flex-wrap">
                        ${catIcon} ${c.address} ${dateTag} ${noteTag}
                    </div>
                    <div class="text-xs text-gray-400">$${c.amount}</div>
                </div>
            </div>
            <button type="button" onclick="deleteCustomerInManager('${c.id}')" class="ignore-drag text-gray-300 hover:text-red-500 p-2 z-10"><i class="fa-solid fa-trash-can pointer-events-none"></i></button>
        `;
        list.appendChild(div);
    });
};

window.deleteCustomerInManager = function(id) { window.deleteCustomer(id); };

window.saveNewOrder = async function() {
    if(!currentUser) return;
    const list = document.getElementById('manageCustomerList');
    const itemEls = list.children;
    const batch = writeBatch(db);
    let hasUpdates = false;
    const currentIds = Array.from(itemEls).map(el => el.getAttribute('data-id'));
    currentIds.forEach((id, index) => {
        const ref = doc(db, 'artifacts', APP_ID, 'public', 'data', 'customers', id);
        batch.update(ref, { order: index });
        hasUpdates = true;
    });
    if(hasUpdates) { try { await batch.commit(); } catch(e) { console.error("Order update failed", e); window.showToast("排序儲存失敗"); } }
};

window.managerAddCustomer = async function() {
    if(!currentUser) return;
    const addr = document.getElementById('mgrNewAddr').value.trim();
    const amt = parseInt(document.getElementById('mgrNewAmt').value);
    const sDate = document.getElementById('mgrNewServiceDate').value;
    const cat = window.appState.reportCategory === 'all' ? 'stairs' : window.appState.reportCategory;
    if(!addr || isNaN(amt)) { alert("請輸入地址和金額"); return; }
    let maxOrder = 0;
    window.appState.customers.forEach(c => { if(c.order && c.order > maxOrder) maxOrder = c.order; });
    const data = {
        address: addr, amount: amt, category: cat, collector: window.appState.currentCollector,
        createdAt: serverTimestamp(), order: maxOrder + 1, serviceDate: sDate || '', note: ''
    };
    try {
        await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', 'customers'), data);
        document.getElementById('mgrNewAddr').value = '';
        document.getElementById('mgrNewAmt').value = '';
        document.getElementById('mgrNewServiceDate').value = '';
        window.showToast("已新增");
    } catch(e) { window.showToast("新增失敗"); }
};

window.saveCustomer = async function() {
    if(!currentUser) return;
    const addr = document.getElementById('newCustAddr').value.trim();
    const amt = parseInt(document.getElementById('newCustAmt').value);
    const floor = document.getElementById('newCustFloor').value.trim();
    const sDate = document.getElementById('newCustServiceDate').value;
    const note = document.getElementById('newCustNote').value.trim(); 
    const cat = document.getElementById('editCustCategory').value;
    const id = window.appState.editingCustomerId;
    if(!addr || isNaN(amt)) { alert("請填寫地址和金額"); return; }
    const data = { 
        address: addr, amount: amt, floor: floor, category: cat, 
        collector: window.appState.currentCollector, serviceDate: sDate || '',
        note: note
    };
    try {
        if(id) { await updateDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'customers', id), data); window.showToast("已更新"); } 
        else { data.createdAt = serverTimestamp(); data.order = Date.now(); await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', 'customers'), data); window.showToast("已儲存"); }
        closeAddCustomerModal(null);
    } catch(e) { window.showToast("儲存失敗"); }
};

window.openEditCustomerModal = function(id, addr, amt, floor, cat, serviceDate, note) {
    window.appState.editingCustomerId = id;
    document.getElementById('customerModalTitle').innerText = '編輯常用客戶';
    document.getElementById('newCustAddr').value = addr;
    document.getElementById('newCustAmt').value = amt;
    document.getElementById('newCustFloor').value = floor || '';
    document.getElementById('newCustServiceDate').value = serviceDate || '';
    document.getElementById('newCustNote').value = note || '';
    window.setEditCustCategory(cat || 'stairs');
    document.getElementById('addCustomerModal').classList.remove('hidden');
};

window.editCustNote = async function(id, currentNote) {
    if(!currentUser) return;
    const newNote = prompt("修改備註：", currentNote);
    if(newNote !== null && newNote !== currentNote) {
        try { await updateDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'customers', id), { note: newNote }); window.showToast("備註已更新"); } 
        catch(e) { window.showToast("更新失敗"); }
    }
};

window.updateCustomerPrice = async function(address, newAmount) {
    const cust = window.appState.customers.find(c => c.address === address);
    if(cust) {
        try {
            await updateDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'customers', cust.id), { amount: parseInt(newAmount) });
            window.showToast(`已更新 ${address} 的預設金額為 $${newAmount}`);
        } catch(e) { console.error("Price update failed", e); }
    }
};

// --- Window Functions (UI Logic) ---
window.setReportCategory = function(cat) {
    window.appState.reportCategory = cat;
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
            btn.classList.remove('text-emerald-600'); btn.classList.add('text-gray-400');
            btn.querySelector('span').className = 'text-[10px] font-medium';
        }
    });
    document.getElementById(`view-${viewName}`).classList.remove('hidden');
    const active = document.getElementById(`nav-${viewName}`);
    if(active) {
        active.classList.remove('text-gray-400'); active.classList.add('text-emerald-600');
        active.querySelector('span').className = 'text-[10px] font-bold';
    }
    window.scrollTo(0,0);
    refreshCurrentView();
};

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
    try {
        await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', 'pending'), newItem);
        clearFormData();
        window.showToast("📋 已加入清單");
    } catch (e) { console.error(e); window.showToast("❌ 加入失敗"); }
};

window.completePending = async function(docId, data) {
    if(!currentUser) return;
    const record = { ...data, collector: window.appState.currentCollector, createdAt: serverTimestamp() };
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
     try { await updateDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'records', docId), { status: newStatus }); window.showToast("狀態已更新"); } catch(e) { window.showToast("更新失敗"); }
};

window.updatePendingAddress = async function(docId, newAddress) {
    if(!currentUser || !newAddress) return;
    try { await updateDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'pending', docId), { address: newAddress }); } catch(e) { console.error(e); window.showToast("更新地址失敗"); }
};

window.deletePending = function(docId) { window.openDeleteModal('single', docId); };
window.confirmClearAllPending = function() {
    const count = document.getElementById('pendingCount').innerText;
    if (count === '0') { window.showToast("清單已經是空的了"); return; }
    window.openDeleteModal('all', null);
};

window.openDeleteModal = function(type, id) {
    window.appState.deleteType = type;
    window.appState.deleteTargetId = id;
    const textEl = document.getElementById('deleteConfirmText');
    const btn = document.getElementById('confirmDeleteBtn');
    if (type === 'all') { textEl.innerText = "這將清空「所有」待收項目，無法復原。"; btn.innerText = "全部清空"; btn.onclick = window.doClearAllPending; } 
    else { textEl.innerText = "確定移除此待收項目？"; btn.innerText = "確定刪除"; btn.onclick = () => window.doDeletePending(window.appState.deleteTargetId); }
    document.getElementById('deleteConfirmModal').classList.remove('hidden');
};

window.closeDeleteModal = function(e) { if(e && e.target !== e.currentTarget) return; document.getElementById('deleteConfirmModal').classList.add('hidden'); };
window.doDeletePending = async function(docId) { if(!currentUser) return; await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'pending', docId)); window.closeDeleteModal(null); window.showToast("🗑️ 已刪除"); };
window.doClearAllPending = async function() { if(!currentUser) return; const current = window.appState.currentCollector; const items = window.appState.pending.filter(i => (i.collector === current) || (!i.collector && current === '子晴') ); const batch = writeBatch(db); items.forEach(item => { const ref = doc(db, 'artifacts', APP_ID, 'public', 'data', 'pending', item.id); batch.delete(ref); }); try { await batch.commit(); window.closeDeleteModal(null); window.showToast("🗑️ 清單已清空"); } catch(e) { console.error(e); window.showToast("清空失敗"); } };
window.deleteCustomer = async function(docId) { if(!currentUser) return; if(confirm("確定從常用名單移除？(不會刪除歷史記帳紀錄)")) { await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'customers', docId)); window.showToast("🗑️ 已刪除"); } };
// --- 6. 表單與其他輔助功能 ---

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
    const appointmentTime = document.getElementById('inputAppointment').value;

    if (!address) { window.showToast("⚠️ 請輸入地址！"); document.getElementById('inputAddress').focus(); return null; }
    if (isNaN(amount)) { window.showToast("⚠️ 請輸入金額！"); document.getElementById('inputAmount').focus(); return null; }

    return { 
        date: dateInput, serviceDate: serviceDate, address, floor, months, amount, 
        type, category, collector, note, status, appointmentTime, 
        createdAt: serverTimestamp() 
    };
}

function clearFormData() {
    document.getElementById('inputAddress').value = '';
    document.getElementById('inputFloor').value = '';
    document.getElementById('inputAmount').value = '';
    document.getElementById('inputNote').value = '';
    document.getElementById('inputAppointment').value = '';
    window.resetMonthPicker();
    window.setStatus('completed'); 
}

// --- 7. 報表邏輯 (Year Report) ---

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

    let records = window.appState.records.filter(r => {
        const rCol = r.collector || '子晴';
        if(rCol !== current) return false;
        const rCat = r.category || 'stairs';
        if(catFilter !== 'all' && rCat !== catFilter) return false;
        return true;
    });

    const custs = window.appState.customers.filter(c => {
        if(!((c.collector === current) || (!c.collector && current === '子晴'))) return false;
        const cCat = c.category || 'stairs';
        if(catFilter !== 'all' && cCat !== catFilter) return false;
        return true;
    });

    const addresses = custs.map(c => c.address);
    records.forEach(r => { if(!addresses.includes(r.address)) addresses.push(r.address); });

    if(addresses.length === 0) { 
        container.innerHTML = '<div class="text-center text-gray-400 py-10">尚無資料</div>'; 
        return; 
    } 

    addresses.forEach(addr => { 
        const addrRecords = window.appState.records.filter(r => r.address === addr); 
        const custData = custs.find(c => c.address === addr);
        const custNote = (custData && custData.note) ? custData.note : '';
        let isTank = false;
        if (custData && custData.category === 'tank') isTank = true;
        else if (addrRecords.length > 0 && addrRecords[0].category === 'tank') isTank = true;

        const noteHtml = custNote 
            ? `<span onclick="editCustNote('${custData ? custData.id : ''}', '${custNote}')" class="ml-2 text-xs text-orange-500 cursor-pointer hover:bg-orange-50 px-1 rounded"><i class="fa-solid fa-note-sticky"></i> ${custNote}</span>` 
            : `<span onclick="editCustNote('${custData ? custData.id : ''}', '')" class="ml-2 text-xs text-gray-300 cursor-pointer hover:text-blue-500"><i class="fa-regular fa-pen-to-square"></i></span>`;
        
        const card = document.createElement('div'); 
        card.className = 'bg-white p-3 rounded-lg border border-gray-100 shadow-sm mb-3'; 
        
        if (isTank) {
            let listHtml = '<div class="space-y-2">';
            const yearRecords = addrRecords.filter(r => r.date.startsWith(String(year)));
            yearRecords.sort((a, b) => b.date.localeCompare(a.date));

            if (yearRecords.length === 0) {
                listHtml += '<div class="text-xs text-gray-400 text-center py-2 bg-gray-50 rounded">本年度尚無紀錄</div>';
            } else {
                yearRecords.forEach(r => {
                    const d = new Date(r.date);
                    const dateStr = `${d.getMonth()+1}/${d.getDate()}`;
                    let sDateStr = '';
                    if(r.serviceDate) {
                        const sd = new Date(r.serviceDate);
                        sDateStr = `<span class="bg-cyan-50 text-cyan-600 px-1 rounded ml-1">🚿 ${sd.getMonth()+1}/${sd.getDate()}</span>`;
                    }
                    let statusHtml = '';
                    if(r.status === 'no_receipt') statusHtml = `<span class="text-red-500 text-xs ml-2"><i class="fa-solid fa-triangle-exclamation"></i> 欠單</span>`;
                    else if(r.status === 'no_payment') statusHtml = `<span class="text-orange-500 text-xs ml-2"><i class="fa-solid fa-hourglass-half"></i> 欠款</span>`;
                    
                    const safeNote = (r.note || '').replace(/'/g, "\\'");
                    const onclick = `openReportAction('edit', '${addr}', ${year}, ${d.getMonth()+1}, '${r.id}', '${r.date}', ${r.amount}, '${r.type}', '${r.floor || ''}', '${safeNote}', '${r.status}', '${r.months || ''}')`;

                    listHtml += `
                        <div onclick="${onclick}" class="flex justify-between items-center p-2 border-b border-gray-100 active:bg-gray-50 cursor-pointer">
                            <div>
                                <div class="text-sm font-bold text-gray-700">📅 ${dateStr} ${sDateStr} ${statusHtml}</div>
                                <div class="text-xs text-gray-400 mt-0.5">${r.floor ? r.floor+'樓' : ''} ${r.note ? '('+r.note+')' : ''}</div>
                            </div>
                            <div class="font-bold text-emerald-600">$${r.amount}</div>
                        </div>`;
                });
            }
            listHtml += '</div>';
            
            const addBtn = `<button type="button" onclick="openReportAction('add', '${addr}', ${year}, ${new Date().getMonth()+1})" class="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded hover:bg-blue-100"><i class="fa-solid fa-plus"></i></button>`;
            
            card.innerHTML = ` 
                <div class="font-bold text-cyan-700 mb-2 border-b border-cyan-100 pb-2 text-sm flex justify-between items-center"> 
                    <div><span>💧 ${addr}</span> ${noteHtml}</div> 
                    <div class="flex items-center gap-2">
                        <span class="text-xs text-gray-300 font-normal">#${year}</span>
                        ${addBtn}
                    </div>
                </div> 
                ${listHtml} 
            `;

        } else {
            const monthInfo = Array(13).fill(null); 
            addrRecords.forEach(r => { 
                const d = new Date(r.date); 
                const collectDate = (d instanceof Date && !isNaN(d)) ? `${d.getMonth()+1}/${d.getDate()}` : '??'; 
                if (r.months && r.months.includes(`${year}年`)) { 
                    const parts = r.months.match(new RegExp(`${year}年\\s*([0-9,]+)`)); 
                    if(parts && parts[1]) { 
                        const paidMonths = parts[1].split(',').map(Number); 
                        paidMonths.forEach(m => { 
                            if(m >= 1 && m <= 12) { 
                                let status = 'paid'; 
                                if(r.status === 'no_payment') status = 'no_payment'; 
                                else if(r.status === 'no_receipt') status = 'no_receipt';
                                monthInfo[m] = { 
                                    status: status, date: collectDate, id: r.id, 
                                    amount: r.amount, fullDate: r.date, 
                                    type: r.type || 'cash', floor: r.floor || '',
                                    note: r.note || '',
                                    months: r.months 
                                }; 
                            } 
                        }); 
                    } 
                } 
            }); 

            let monthHtml = ''; 
            for(let m=1; m<=12; m++) { 
                const info = monthInfo[m]; 
                let boxClass = 'border border-gray-100 bg-gray-50 rounded p-2 flex flex-col justify-between min-h-[70px] relative transition-all active:scale-95';
                let content = `<span class="text-xs text-gray-300 font-bold absolute top-1 right-2">${m}月</span>`; 
                let onclick = `openReportAction('add', '${addr}', ${year}, ${m})`; 

                if(info) { 
                    const safeNote = (info.note || '').replace(/'/g, "\\'");
                    const safeMonths = (info.months || '').replace(/'/g, "\\'");
                    onclick = `openReportAction('edit', '${addr}', ${year}, ${m}, '${info.id}', '${info.fullDate}', ${info.amount}, '${info.type}', '${info.floor}', '${safeNote}', '${info.status}', '${safeMonths}')`; 
                    
                    let typeText = '💵'; let typeBg = 'bg-emerald-50 text-emerald-700';
                    if(info.type === 'transfer') { typeText = '🏦'; typeBg = 'bg-blue-50 text-blue-700'; }
                    if(info.type === 'linepay') { typeText = 'LP'; typeBg = 'bg-lime-50 text-lime-700'; }
                    if(info.type === 'dad') { typeText = '👴'; typeBg = 'bg-purple-50 text-purple-700'; }
                    let borderClass = 'border-emerald-200 bg-white';
                    if(info.status === 'no_receipt') borderClass = 'border-red-300 bg-red-50'; 
                    if(info.status === 'no_payment') borderClass = 'border-orange-300 bg-orange-50'; 
                    let noteIcon = info.note ? `<i class="fa-solid fa-note-sticky text-yellow-500 text-[10px] ml-1"></i>` : '';

                    boxClass = `border ${borderClass} rounded p-2 flex flex-col justify-between min-h-[70px] relative shadow-sm cursor-pointer active:scale-95`;
                    content = `<div class="flex justify-between items-start mb-1"><span class="text-xs font-bold text-gray-400 flex items-center">${m}月${noteIcon}</span><span class="text-[10px] px-1 rounded ${typeBg}">${typeText}</span></div><div class="flex justify-between items-end"><div><div class="text-[10px] text-gray-500">${info.date}收</div><div class="text-xs font-bold text-gray-700">${info.floor ? info.floor : ''}</div></div><div class="font-bold text-emerald-600 text-sm">$${info.amount}</div></div>`;
                } 
                monthHtml += `<div class="${boxClass}" onclick="${onclick}">${content}</div>`; 
            } 
            card.innerHTML = ` <div class="font-bold text-gray-700 mb-2 border-b pb-1 text-sm flex justify-between items-center"> <div><span>${addr}</span> ${noteHtml}</div> <span class="text-xs text-gray-300 font-normal">#${year}</span> </div> <div class="grid grid-cols-2 sm:grid-cols-3 gap-2"> ${monthHtml} </div> `; 
        } 
        container.appendChild(card); 
    }); 
};

// NEW: 欠費偵測邏輯
window.checkArrears = function() {
    const current = window.appState.currentCollector;
    const customers = window.appState.customers.filter(c => (c.collector === current) || (!c.collector && current === '子晴'));
    
    // 計算當前絕對月份 (Year * 12 + Month)
    const now = new Date();
    const currentTwYear = now.getFullYear() - 1911;
    const currentMonth = now.getMonth() + 1;
    const currentAbs = currentTwYear * 12 + currentMonth;

    const list = document.getElementById('arrearsList');
    list.innerHTML = '';
    let count = 0;

    customers.forEach(c => {
        if(c.category === 'tank') return; // 忽略水塔

        let maxAbsPaid = 0;
        const recs = window.appState.records.filter(r => r.address === c.address);
        
        if (recs.length === 0) {
            maxAbsPaid = 0; 
        } else {
            recs.forEach(r => {
                if(r.status === 'no_payment' || !r.months) return; // 沒入帳的不算
                const regex = /(\d+)年\s*([0-9,]+)/g;
                let match;
                while ((match = regex.exec(r.months)) !== null) {
                    const y = parseInt(match[1]);
                    const ms = match[2].split(',').map(Number);
                    ms.forEach(m => {
                        const abs = y * 12 + m;
                        if(abs > maxAbsPaid) maxAbsPaid = abs;
                    });
                }
            });
        }

        let gap = 0;
        let lastPaidStr = "無紀錄";
        
        if (maxAbsPaid > 0) {
            gap = currentAbs - maxAbsPaid;
            const lpYear = Math.floor((maxAbsPaid - 1) / 12);
            const lpMonth = (maxAbsPaid - 1) % 12 + 1;
            lastPaidStr = `${lpYear}年${lpMonth}月`;
        } else {
            gap = 999; // 無紀錄標記
        }

        // 判斷條件：差距 >= 1 個月
        if (gap >= 1) {
            count++;
            const gapText = gap === 999 ? '新客戶 / 無紀錄' : `<span class="text-red-500 font-bold">${gap} 個月未繳</span>`;
            const item = document.createElement('div');
            item.className = 'p-3 border border-red-100 rounded-lg bg-red-50 mb-2 flex justify-between items-center';
            item.innerHTML = `
                <div>
                    <div class="font-bold text-gray-800">${c.address}</div>
                    <div class="text-xs text-gray-500">上次繳至: ${lastPaidStr}</div>
                </div>
                <div class="text-right">
                    <div class="text-sm">${gapText}</div>
                    <div class="text-xs text-emerald-600 font-bold">$${c.amount}</div>
                </div>
            `;
            // 點擊直接開啟補登
            item.onclick = () => {
                window.closeArrearsModal(null);
                let nextMonth = 1;
                let nextYear = currentTwYear;
                if (maxAbsPaid > 0) {
                    const nextAbs = maxAbsPaid + 1;
                    nextYear = Math.floor((nextAbs - 1) / 12);
                    nextMonth = (nextAbs - 1) % 12 + 1;
                }
                window.openReportAction('add', c.address, nextYear, nextMonth);
            };
            list.appendChild(item);
        }
    });

    if (count === 0) {
        list.innerHTML = '<div class="text-center text-gray-400 py-10"><i class="fa-solid fa-check-circle text-4xl text-emerald-200 mb-2"></i><br>太棒了！目前沒有逾期客戶</div>';
    }

    document.getElementById('arrearsModal').classList.remove('hidden');
};

window.closeArrearsModal = function(e) { if(e && e.target !== e.currentTarget) return; document.getElementById('arrearsModal').classList.add('hidden'); };

// --- Modal Functions ---

// NEW: 增加 monthsStr 參數
window.openReportAction = function(mode, address, year, month, recordId, date, amount, type, floor, note, status, monthsStr) { 
    const title = document.getElementById('reportActionTitle'); 
    const content = document.getElementById('reportActionContent'); 
    const getTypeSelect = (id, currentVal) => `<div><label class="block text-xs text-gray-500 mb-1">方式</label><select id="${id}" class="w-full p-2 border rounded bg-white"><option value="cash" ${currentVal === 'cash' ? 'selected' : ''}>💵 現金</option><option value="transfer" ${currentVal === 'transfer' ? 'selected' : ''}>🏦 匯款</option><option value="linepay" ${currentVal === 'linepay' ? 'selected' : ''}>🟢 LinePay</option><option value="dad" ${currentVal === 'dad' ? 'selected' : ''}>👴 匯給爸爸</option></select></div>`;
    const getFloorInput = (id, val) => `<div><label class="block text-xs text-gray-500 mb-1">樓層/戶號</label><input type="text" id="${id}" value="${val || ''}" class="w-full p-2 border rounded bg-white" placeholder="例如：5F"></div>`;
    const getNoteInput = (id, val) => `<div><label class="block text-xs text-gray-500 mb-1">備註</label><input type="text" id="${id}" value="${val || ''}" class="w-full p-2 border rounded bg-white" placeholder="備註..."></div>`;
    
    // Checkbox for Updating Default Price
    const getUpdatePriceCheckbox = () => `<label class="flex items-center mt-2 text-xs text-blue-600 font-bold bg-blue-50 p-2 rounded cursor-pointer select-none"><input type="checkbox" id="updateDefaultPrice" class="mr-2 w-4 h-4"> 同步更新此地址的預設金額</label>`;

    const getStatusButtons = (statusVal) => {
        const isNoReceipt = statusVal === 'no_receipt' ? 'active active-red bg-red-100 border-red-400 text-red-700' : 'bg-red-50 text-red-500 border-red-200';
        const isNoPayment = statusVal === 'no_payment' ? 'active active-orange bg-orange-100 border-orange-400 text-orange-700' : 'bg-orange-50 text-orange-500 border-orange-200';
        return `
            <div><label class="block text-xs font-bold text-gray-500 mb-1">特殊狀態</label><div class="flex gap-2 mb-2">
                <button type="button" onclick="setReportStatus('no_receipt')" id="rep-status-receipt" class="status-btn flex-1 p-2 rounded-lg font-bold border flex justify-center items-center gap-1 transition-all ${isNoReceipt}"><i class="fa-solid fa-file-invoice"></i> 欠收據</button>
                <button type="button" onclick="setReportStatus('no_payment')" id="rep-status-payment" class="status-btn flex-1 p-2 rounded-lg font-bold border flex justify-center items-center gap-1 transition-all ${isNoPayment}"><i class="fa-solid fa-sack-dollar"></i> 欠匯款</button>
            </div><input type="hidden" id="reportEditStatus" value="${statusVal || 'completed'}"></div>
        `;
    };

    if(mode === 'edit') {
        title.innerText = `編輯紀錄：${address}`; 
        
        window.appState.reportBatchMonths.clear();
        if(monthsStr) {
            const parts = monthsStr.match(new RegExp(`${year}年\\s*([0-9,]+)`));
            if(parts && parts[1]) {
                parts[1].split(',').map(Number).forEach(m => window.appState.reportBatchMonths.add(m));
            }
        } else {
            if(month) window.appState.reportBatchMonths.add(month);
        }

        let monthSelectorHtml = '';
        if (monthsStr || month) {
            monthSelectorHtml = '<div class="grid grid-cols-6 gap-2 mb-3">';
            for(let i=1; i<=12; i++) {
                const isSelected = window.appState.reportBatchMonths.has(i) ? 'bg-blue-500 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200';
                monthSelectorHtml += `<button type="button" onclick="toggleBatchMonth(this, ${i})" class="p-2 rounded border text-sm font-bold ${isSelected}">${i}月</button>`;
            }
            monthSelectorHtml += '</div>';
        }

        content.innerHTML = ` 
            ${monthSelectorHtml ? '<div class="text-xs text-gray-400 mb-1">編輯月份</div>' + monthSelectorHtml : ''}
            <div class="grid grid-cols-2 gap-2 mb-2"><div><label class="block text-xs text-gray-500 mb-1">收款日期</label><input type="date" id="reportEditDate" value="${date}" class="w-full p-2 border rounded"></div>${getFloorInput('reportEditFloor', floor)}</div>
            <div class="grid grid-cols-2 gap-2 mb-2">
                <div><label class="block text-xs text-gray-500 mb-1">金額</label><input type="number" id="reportEditAmount" value="${amount}" class="w-full p-2 border rounded"></div>
                ${getTypeSelect('reportEditType', type)}
            </div>
            ${getUpdatePriceCheckbox()}
            ${getStatusButtons(status)}
            ${getNoteInput('reportEditNote', note)}
            <div class="grid grid-cols-2 gap-2 mt-4"><button type="button" onclick="deleteReportRecord('${recordId}')" class="py-2 bg-red-100 text-red-600 rounded-lg font-bold">刪除紀錄</button><button type="button" onclick="updateReportRecord('${recordId}', '${address}', ${year}, document.getElementById('reportEditDate').value, document.getElementById('reportEditAmount').value, document.getElementById('reportEditType').value, document.getElementById('reportEditFloor').value, document.getElementById('reportEditNote').value, document.getElementById('reportEditStatus').value)" class="py-2 bg-blue-600 text-white rounded-lg font-bold">儲存修改</button></div>`; 
    } else { 
        const cust = window.appState.customers.find(c => c.address === address); 
        const defAmount = cust ? cust.amount : ''; 
        const defFloor = cust ? cust.floor : ''; 
        const today = new Date().toISOString().split('T')[0]; 
        
        window.appState.reportBatchMonths.clear();
        if(month > 0) window.appState.reportBatchMonths.add(month); 

        title.innerText = `補登紀錄：${address}`; 
        
        let monthSelectorHtml = '<div class="grid grid-cols-6 gap-2 mb-3">';
        for(let i=1; i<=12; i++) {
            const isSelected = i === month ? 'bg-blue-500 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200';
            monthSelectorHtml += `<button type="button" onclick="toggleBatchMonth(this, ${i})" class="p-2 rounded border text-sm font-bold ${isSelected}">${i}月</button>`;
        }
        monthSelectorHtml += '</div>';

        content.innerHTML = `
            <div class="text-xs text-gray-400 mb-1">選擇月份 (可多選，水塔可忽略)</div>
            ${monthSelectorHtml}
            <div class="grid grid-cols-2 gap-2 mb-2">
                <div><label class="block text-xs text-gray-500 mb-1">收款日期</label><input type="date" id="reportAddDate" value="${today}" class="w-full p-2 border rounded"></div>
                ${getFloorInput('reportAddFloor', defFloor)}
            </div>
            <div class="grid grid-cols-2 gap-2 mb-2">
                <div><label class="block text-xs text-gray-500 mb-1">金額 (單月)</label><input type="number" id="reportAddAmount" value="${defAmount}" placeholder="輸入金額" class="w-full p-2 border rounded"></div>
                ${getTypeSelect('reportAddType', 'cash')}
            </div>
            ${getUpdatePriceCheckbox()}
            ${getStatusButtons('completed')}
            ${getNoteInput('reportAddNote', '')}
            <button type="button" onclick="batchAddReportRecords('${address}', ${year}, document.getElementById('reportAddAmount').value, document.getElementById('reportAddType').value, document.getElementById('reportAddFloor').value, document.getElementById('reportAddNote').value, document.getElementById('reportEditStatus').value)" class="w-full py-3 bg-emerald-500 text-white rounded-lg font-bold mt-4">確認補登</button>`; 
    } 
    document.getElementById('reportActionModal').classList.remove('hidden'); 
};

window.setReportStatus = function(status) {
    const input = document.getElementById('reportEditStatus');
    if (input.value === status) input.value = 'completed'; else input.value = status; 
    const current = input.value; 
    const btnReceipt = document.getElementById('rep-status-receipt'); 
    const btnPayment = document.getElementById('rep-status-payment');
    btnReceipt.className = 'status-btn flex-1 p-2 rounded-lg bg-red-50 text-red-500 border-red-200 font-bold border flex justify-center items-center gap-1 transition-all';
    btnPayment.className = 'status-btn flex-1 p-2 rounded-lg bg-orange-50 text-orange-500 border-orange-200 font-bold border flex justify-center items-center gap-1 transition-all';
    btnReceipt.style.opacity = '1'; btnReceipt.style.filter = 'none';
    btnPayment.style.opacity = '1'; btnPayment.style.filter = 'none';

    if(current === 'no_receipt') { 
        btnReceipt.className = 'status-btn flex-1 p-2 rounded-lg font-bold border flex justify-center items-center gap-1 transition-all active active-red bg-red-100 border-red-400 text-red-700'; 
        btnPayment.style.opacity = '0.6'; btnPayment.style.filter = 'grayscale(1)';
    } else if(current === 'no_payment') { 
        btnPayment.className = 'status-btn flex-1 p-2 rounded-lg font-bold border flex justify-center items-center gap-1 transition-all active active-orange bg-orange-100 border-orange-400 text-orange-700'; 
        btnReceipt.style.opacity = '0.6'; btnReceipt.style.filter = 'grayscale(1)';
    }
};

window.toggleBatchMonth = function(btn, m) {
    if(window.appState.reportBatchMonths.has(m)) {
        window.appState.reportBatchMonths.delete(m);
        btn.className = 'p-2 rounded border border-gray-200 text-sm font-bold bg-white text-gray-600';
    } else {
        window.appState.reportBatchMonths.add(m);
        btn.className = 'p-2 rounded border border-blue-600 text-sm font-bold bg-blue-500 text-white';
    }
    // document.getElementById('batchCount').innerText = window.appState.reportBatchMonths.size;
};

window.batchAddReportRecords = async function(address, year, amount, type, floor, note, status) { 
    if(!currentUser) return; 
    
    // 檢查是否要更新預設金額
    const updatePrice = document.getElementById('updateDefaultPrice').checked;
    if(updatePrice) { window.updateCustomerPrice(address, amount); }

    const dateInput = document.getElementById('reportAddDate').value;
    const batch = writeBatch(db);
    
    if (window.appState.reportBatchMonths.size > 0) {
        window.appState.reportBatchMonths.forEach(m => {
            const ref = doc(collection(db, 'artifacts', APP_ID, 'public', 'data', 'records'));
            const record = { 
                date: dateInput, address: address, amount: parseInt(amount), floor: floor || '', 
                months: `${year}年 ${m}月`, note: note || '', 
                type: type || 'cash', 
                category: window.appState.reportCategory === 'all' ? 'stairs' : window.appState.reportCategory, 
                collector: window.appState.currentCollector, 
                status: status || 'completed', 
                createdAt: serverTimestamp() 
            }; 
            if(window.appState.reportCategory === 'all') {
                 const cust = window.appState.customers.find(c => c.address === address);
                 if(cust && cust.category) record.category = cust.category;
            }
            batch.set(ref, record);
        });
    } else {
        const ref = doc(collection(db, 'artifacts', APP_ID, 'public', 'data', 'records'));
        const record = { 
            date: dateInput, address: address, amount: parseInt(amount), floor: floor || '', 
            months: '', note: note || '', 
            type: type || 'cash', 
            category: window.appState.reportCategory === 'all' ? 'stairs' : window.appState.reportCategory, 
            collector: window.appState.currentCollector, 
            status: status || 'completed', 
            createdAt: serverTimestamp() 
        }; 
        const cust = window.appState.customers.find(c => c.address === address);
        if(cust && cust.category) record.category = cust.category;
        batch.set(ref, record);
    }

    try { await batch.commit(); window.closeReportActionModal(null); window.showToast(`✅ 已補登`); } catch(e) { console.error(e); window.showToast("補登失敗"); } 
};

window.closeReportActionModal = function(e) { if(e && e.target !== e.currentTarget) return; document.getElementById('reportActionModal').classList.add('hidden'); };

window.updateReportRecord = async function(docId, address, year, date, amount, type, floor, note, status) { 
    if(!currentUser) return; 
    
    // 檢查是否要更新預設金額
    const updatePrice = document.getElementById('updateDefaultPrice').checked;
    if(updatePrice) { window.updateCustomerPrice(address, amount); }

    // 構建新的月份字串
    let newMonthsStr = '';
    if(window.appState.reportBatchMonths.size > 0) {
        const sortedMonths = Array.from(window.appState.reportBatchMonths).sort((a,b)=>a-b);
        newMonthsStr = `${year}年 ${sortedMonths.join(', ')}月`;
    }

    try { 
        const updateData = { 
            date: date, amount: parseInt(amount), type: type, floor: floor, note: note, status: status 
        };
        // 只有當真的有選月份時才更新 months 欄位
        if(newMonthsStr) {
            updateData.months = newMonthsStr;
        }

        await updateDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'records', docId), updateData); 
        window.closeReportActionModal(null); 
        window.showToast("已更新"); 
    } catch(e) { window.showToast("更新失敗"); } 
};

window.deleteReportRecord = async function(docId) { if(!currentUser) return; if(confirm("確定刪除？這月份將變回未收狀態")) { await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'records', docId)); window.closeReportActionModal(null); window.showToast("🗑️ 已刪除"); } };

// --- 8. UI RENDERING (Lists) ---
window.renderPendingList = function() { 
    const list = document.getElementById('pendingList'); 
    const container = document.getElementById('pendingContainer'); 
    const current = window.appState.currentCollector; 
    const allItems = window.appState.pending.filter(i => (i.collector === current) || (!i.collector && current === '子晴') );
    if (allItems.length === 0) { container.classList.add('hidden'); return; } 
    container.classList.remove('hidden'); 
    document.getElementById('pendingCount').innerText = allItems.length; 
    list.innerHTML = ''; 
    const appointments = allItems.filter(i => i.appointmentTime);
    const normals = allItems.filter(i => !i.appointmentTime);
    appointments.sort((a, b) => a.appointmentTime.localeCompare(b.appointmentTime));
    normals.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    if (appointments.length > 0) {
        list.innerHTML += `<div class="font-bold text-red-500 mb-2 mt-1 px-1 flex items-center gap-2"><i class="fa-solid fa-calendar-check"></i> 預約 / 急件 (${appointments.length})</div>`;
        appointments.forEach(item => { list.appendChild(createPendingItem(item, true)); });
    }
    if (normals.length > 0) {
        if (appointments.length > 0) {
            list.innerHTML += `<div class="font-bold text-gray-500 mb-2 mt-4 px-1 flex items-center gap-2 border-t pt-3"><i class="fa-solid fa-route"></i> 一般路線 (${normals.length})</div>`;
        }
        normals.forEach(item => { list.appendChild(createPendingItem(item, false)); });
    }
};

function createPendingItem(item, isAppointment) {
    const floorId = `p-floor-${item.id}`; 
    const monthsId = `p-months-${item.id}`; 
    const noteId = `p-note-${item.id}`; 
    const typeId = `p-type-${item.id}`; 
    const catIcon = item.category === 'tank' ? '<span class="text-cyan-600">💧</span>' : '<span class="text-orange-600">🪜</span>'; 
    let sTag = ''; 
    if(item.serviceDate) { sTag = `<span class="text-xs bg-cyan-100 text-cyan-700 px-1 rounded ml-1 font-bold">洗:${item.serviceDate.slice(5)}</span>`; } 
    let timeTag = '';
    let bgClass = 'bg-white';
    if (item.appointmentTime) {
        bgClass = 'bg-yellow-50 border-yellow-200';
        const d = new Date(item.appointmentTime);
        const timeStr = `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        timeTag = `<div class="bg-red-100 text-red-600 px-2 py-1 rounded text-xs font-bold flex items-center gap-1 mb-2 w-fit shadow-sm"><i class="fa-solid fa-clock"></i> ${timeStr}</div>`;
    }
    const div = document.createElement('div'); 
    div.className = `${bgClass} p-3 rounded-xl border shadow-sm relative mb-2`; 
    div.innerHTML = ` 
        ${timeTag}
        <div class="flex justify-between items-start mb-2 pr-8"> 
            <div class="flex items-center gap-2 flex-1"> 
                <div class="text-xl">${catIcon}</div> 
                <div class="w-full">
                    <input type="text" value="${item.address}" onchange="updatePendingAddress('${item.id}', this.value)" class="font-bold text-lg text-gray-800 bg-transparent w-full focus:bg-gray-50 rounded px-1 outline-none border-b border-transparent focus:border-gray-300 transition-colors">
                    ${sTag}
                </div> 
            </div> 
            <div class="font-bold text-emerald-600 text-lg flex-shrink-0">$${item.amount}</div> 
        </div> 
        <div class="space-y-2"> 
            <div class="flex gap-2"> 
                <input id="${monthsId}" value="${item.months || ''}" readonly onclick="openPendingMonthPicker('${item.id}', '${item.months||''}')" placeholder="選擇月份" class="bg-blue-50 border border-blue-200 rounded p-2 text-sm w-1/2 text-center text-blue-700 font-bold cursor-pointer"> 
                <input id="${floorId}" value="${item.floor || ''}" placeholder="樓層/戶號" class="bg-gray-50 border rounded p-2 text-sm w-1/2 text-center font-medium"> 
            </div> 
            <div class="flex gap-2 items-center"> 
                <select id="${typeId}" class="bg-gray-50 border rounded p-2 text-sm w-20"> <option value="cash" ${item.type === 'cash' ? 'selected' : ''}>現金</option> <option value="transfer" ${item.type === 'transfer' ? 'selected' : ''}>匯款</option> <option value="linepay" ${item.type === 'linepay' ? 'selected' : ''}>LinePay</option> <option value="dad" ${item.type === 'dad' ? 'selected' : ''}>匯給爸爸</option> </select> 
                <input id="${noteId}" value="${item.note || ''}" placeholder="備註..." class="bg-gray-50 border rounded p-2 text-sm flex-1"> 
                <button type="button" onclick="openConfirmCollectionModal('${item.id}', ${item.amount}, '${item.address}', '${item.category || 'stairs'}', '${item.serviceDate || ''}')" class="bg-green-500 text-white w-10 h-10 rounded-full shadow flex items-center justify-center active:scale-90 transition-transform flex-shrink-0"> <i class="fa-solid fa-check"></i> </button> 
            </div> 
        </div> 
        <button type="button" onclick="deletePending('${item.id}')" class="absolute top-2 right-2 text-gray-300 hover:text-red-400 p-1"><i class="fa-solid fa-times"></i></button> 
    `; 
    return div;
}

window.renderRecords = function() { const list = document.getElementById('recordList'); const records = window.appState.records.filter(r => { const rCol = r.collector || '子晴'; return rCol === window.appState.currentCollector; }); list.innerHTML = ''; document.getElementById('recordCount').innerText = records.length; if (records.length === 0) { list.innerHTML = `<div class="text-center text-gray-400 py-12 opacity-60"><i class="fa-solid fa-clipboard-list text-4xl mb-3"></i><p>尚無 ${window.appState.currentCollector} 的紀錄</p></div>`; return; } records.forEach(record => { let tagClass = 'tag-cash'; let tagText = '現金'; if(record.type === 'transfer') { tagClass = 'tag-transfer'; tagText = '匯款'; } else if(record.type === 'linepay') { tagClass = 'tag-linepay'; tagText = 'LinePay'; } else if(record.type === 'dad') { tagClass = 'tag-dad'; tagText = '已匯給爸爸'; } let noteHtml = record.note ? `<div class="text-sm mt-2 p-2 rounded-lg border border-gray-100 bg-gray-50 text-gray-600 flex items-center gap-2"><i class="fa-regular fa-comment-dots"></i> <span>${record.note}</span></div>` : ''; const dateObj = new Date(record.date); const displayDate = `${dateObj.getMonth()+1}/${dateObj.getDate()}`; let sTag = ''; if(record.category === 'tank') sTag = `<span class="text-xs font-bold px-2 py-0.5 rounded-full tag-tank flex items-center gap-1">💧 洗水塔</span>`; else sTag = `<span class="text-xs font-bold px-2 py-0.5 rounded-full tag-stairs flex items-center gap-1">🪜 洗樓梯</span>`; let serviceTag = ''; if(record.serviceDate) { const sDate = new Date(record.serviceDate); const sDateStr = `${sDate.getMonth()+1}/${sDate.getDate()}`; serviceTag = `<span class="text-xs font-bold px-2 py-0.5 rounded-full bg-cyan-100 text-cyan-700 flex items-center gap-1 ml-1"><i class="fa-solid fa-soap"></i> 洗:${sDateStr}</span>`; } let statusHtml = ''; if(record.status === 'no_receipt') { statusHtml = `<div class="mt-2 bg-red-50 p-2 rounded-lg border border-red-200 flex justify-between items-center"><span class="text-xs font-bold text-red-600"><i class="fa-solid fa-triangle-exclamation"></i> 待給收據</span><button onclick="updateRecordStatus('${record.id}', 'completed')" class="px-3 py-1 bg-red-500 text-white text-xs rounded-full shadow active:scale-95">已補單</button></div>`; } else if(record.status === 'no_payment') { statusHtml = `<div class="mt-2 bg-orange-50 p-2 rounded-lg border border-orange-200 flex justify-between items-center"><span class="text-xs font-bold text-orange-600"><i class="fa-solid fa-hourglass-half"></i> 待確認匯款</span><button onclick="updateRecordStatus('${record.id}', 'completed')" class="px-3 py-1 bg-orange-500 text-white text-xs rounded-full shadow active:scale-95">款項已入</button></div>`; } const item = document.createElement('div'); item.className = 'card p-4 relative border-l-4 ' + (record.type === 'cash' ? 'border-gray-400' : 'border-gray-300'); item.innerHTML = ` <div class="flex justify-between items-start"> <div class="flex-1 mr-2"> <div class="flex items-center gap-2 mb-1 flex-wrap"> <span class="text-xs font-bold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">${displayDate}</span> ${sTag} ${serviceTag} <span class="text-xs font-bold px-2 py-0.5 rounded-full ${tagClass} flex items-center gap-1">${tagText}</span> </div> <div class="text-xl font-bold text-gray-800 leading-tight mb-1">${record.address} <span class="text-base font-normal text-gray-500 ml-1">${record.floor || ''}</span></div> <div class="text-sm text-blue-600 font-bold bg-blue-50 inline-block px-2 py-0.5 rounded border border-blue-100"><i class="fa-regular fa-calendar-check mr-1"></i> ${record.months || '未填月份'}</div> </div> <div class="text-right"><div class="text-2xl font-bold font-mono text-gray-800">$${record.amount.toLocaleString()}</div></div> </div> ${statusHtml} ${noteHtml} <button type="button" onclick="deleteRecord('${record.id}')" class="absolute top-2 right-2 text-gray-200 hover:text-red-400 p-2"><i class="fa-solid fa-trash-can"></i></button> `; list.appendChild(item); }); };

// --- 9. Helper Functions ---
window.openConfirmCollectionModal = function(id, amount, address, category, serviceDate) { const floor = document.getElementById(`p-floor-${id}`).value; const months = document.getElementById(`p-months-${id}`).value; const note = document.getElementById(`p-note-${id}`).value; const type = document.getElementById(`p-type-${id}`).value; window.appState.currentPendingAction = { id, amount, address, category, floor, months, note, type }; document.getElementById('confirmModalAddress').innerText = address; document.getElementById('confirmModalMonths').value = months; document.getElementById('confirmModalAmount').innerText = `$${amount}`; document.getElementById('confirmModalNote').value = note || ''; const today = new Date().toISOString().split('T')[0]; document.getElementById('confirmModalDate').value = today; document.getElementById('confirmModalServiceDate').value = serviceDate || ''; document.getElementById('confirmModalType').value = type; window.setModalStatus('completed'); document.getElementById('confirmCollectionModal').classList.remove('hidden'); document.getElementById('confirmCollectionBtn').onclick = doConfirmCollection; };
window.closeConfirmCollectionModal = function(e) { if(e && e.target !== e.currentTarget) return; document.getElementById('confirmCollectionModal').classList.add('hidden'); };
window.doConfirmCollection = function() { const action = window.appState.currentPendingAction; if(!action) return; const date = document.getElementById('confirmModalDate').value; const serviceDate = document.getElementById('confirmModalServiceDate').value; const months = document.getElementById('confirmModalMonths').value; const type = document.getElementById('confirmModalType').value; const status = document.getElementById('modalInputStatus').value; const note = document.getElementById('confirmModalNote').value; if(!date) { alert("請選擇收款日期"); return; } window.completePending(action.id, { date: date, serviceDate: serviceDate, amount: action.amount, address: action.address, floor: action.floor, months: months, note: note, type: type, category: action.category, status: status }); closeConfirmCollectionModal(null); };
window.setStatus = function(status) { const input = document.getElementById('inputStatus'); if (input.value === status) input.value = 'completed'; else input.value = status; const current = input.value; const btnReceipt = document.getElementById('btn-status-receipt'); const btnPayment = document.getElementById('btn-status-payment'); const baseClass = 'status-btn flex-1 p-2 rounded-lg font-bold border flex justify-center items-center gap-1 transition-all'; btnReceipt.className = baseClass + ' bg-red-50 text-red-500 border-red-200'; btnPayment.className = baseClass + ' bg-orange-50 text-orange-500 border-orange-200'; if(current === 'no_receipt') { btnReceipt.className = baseClass + ' active active-red bg-red-100 border-red-400 text-red-700'; } else if(current === 'no_payment') { btnPayment.className = baseClass + ' active active-orange bg-orange-100 border-orange-400 text-orange-700'; } else { btnReceipt.style.opacity = '0.6'; btnReceipt.style.filter = 'grayscale(1)'; btnPayment.style.opacity = '0.6'; btnPayment.style.filter = 'grayscale(1)'; return; } btnReceipt.style.opacity = '1'; btnReceipt.style.filter = 'none'; btnPayment.style.opacity = '1'; btnPayment.style.filter = 'none'; if (current === 'no_receipt') { btnPayment.style.opacity = '0.6'; btnPayment.style.filter = 'grayscale(1)'; } else if (current === 'no_payment') { btnReceipt.style.opacity = '0.6'; btnReceipt.style.filter = 'grayscale(1)'; } };
window.setModalStatus = function(status) { const input = document.getElementById('modalInputStatus'); if (input.value === status) input.value = 'completed'; else input.value = status; const current = input.value; const btnReceipt = document.getElementById('modal-status-receipt'); const btnPayment = document.getElementById('modal-status-payment'); const baseClass = 'status-btn flex-1 p-2 rounded-lg font-bold border flex justify-center items-center gap-1 transition-all'; btnReceipt.className = baseClass + ' bg-red-50 text-red-500 border-red-200'; btnPayment.className = baseClass + ' bg-orange-50 text-orange-500 border-orange-200'; if(current === 'no_receipt') { btnReceipt.className = baseClass + ' active active-red bg-red-100 border-red-400 text-red-700'; } else if(current === 'no_payment') { btnPayment.className = baseClass + ' active active-orange bg-orange-100 border-orange-400 text-orange-700'; } else { btnReceipt.style.opacity = '0.6'; btnReceipt.style.filter = 'grayscale(1)'; btnPayment.style.opacity = '0.6'; btnPayment.style.filter = 'grayscale(1)'; return; } btnReceipt.style.opacity = '1'; btnReceipt.style.filter = 'none'; btnPayment.style.opacity = '1'; btnPayment.style.filter = 'none'; if (current === 'no_receipt') { btnPayment.style.opacity = '0.6'; btnPayment.style.filter = 'grayscale(1)'; } else if (current === 'no_payment') { btnReceipt.style.opacity = '0.6'; btnReceipt.style.filter = 'grayscale(1)'; } };
window.changeYear = function(delta) { window.appState.pickerYear += delta; window.renderMonthPicker(); const addr = document.getElementById('inputAddress').value; if(addr) window.checkPaidStatus(addr); };
window.renderMonthPicker = function() { document.getElementById('pickerYearDisplay').innerText = `${window.appState.pickerYear}年`; const container = document.getElementById('monthPickerGrid'); container.innerHTML = ''; for(let i=1; i<=12; i++) { const btn = document.createElement('button'); btn.type = 'button'; btn.id = `mbtn-${i}`; btn.className = 'month-btn'; btn.innerText = `${i}月`; btn.onclick = () => window.toggleMonth(i); container.appendChild(btn); } window.appState.selectedMonthsSet.forEach(key => { const [y, m] = key.split('-').map(Number); if(y === window.appState.pickerYear) { const btn = document.getElementById(`mbtn-${m}`); if(btn) btn.classList.add('selected'); } }); };
window.toggleMonth = function(m) { const btn = document.getElementById(`mbtn-${m}`); if(btn.classList.contains('paid')) return; const key = `${window.appState.pickerYear}-${m}`; if(window.appState.selectedMonthsSet.has(key)) { window.appState.selectedMonthsSet.delete(key); btn.classList.remove('selected'); } else { window.appState.selectedMonthsSet.add(key); btn.classList.add('selected'); } window.updateSelectedMonthsInput(); const count = window.appState.selectedMonthsSet.size; if(window.appState.currentBaseAmount > 0 && count > 0) { const total = window.appState.currentBaseAmount * count; document.getElementById('inputAmount').value = total; } };
window.updateSelectedMonthsInput = function() { const groups = {}; window.appState.selectedMonthsSet.forEach(key => { const [y, m] = key.split('-').map(Number); if(!groups[y]) groups[y] = []; groups[y].push(m); }); const parts = []; Object.keys(groups).sort().forEach(y => { const months = groups[y].sort((a,b)=>a-b).join(','); parts.push(`${y}年 ${months}月`); }); document.getElementById('selectedMonths').value = parts.join(', '); document.getElementById('statusHint').innerText = parts.join(', ') || '請選擇...'; };
window.resetMonthPicker = function() { window.appState.selectedMonthsSet.clear(); document.querySelectorAll('.month-btn').forEach(b => { b.classList.remove('selected', 'paid'); b.removeAttribute('data-date'); }); window.updateSelectedMonthsInput(); window.appState.currentBaseAmount = 0; };
let checkTimeout; window.debounceCheckPaidStatus = function(address) { clearTimeout(checkTimeout); checkTimeout = setTimeout(() => { window.checkPaidStatus(address); }, 500); };
window.checkPaidStatus = function(address) { document.querySelectorAll('.month-btn').forEach(b => { b.classList.remove('paid'); b.removeAttribute('data-date'); }); if(!address) return; const records = window.appState.records.filter(r => r.address === address); const paidMap = new Map(); const regex = /(\d+)年\s*([0-9,]+)/g; records.forEach(r => { if(r.months) { const d = new Date(r.date); const dateStr = `${d.getMonth()+1}/${d.getDate()}`; let match; const localRegex = new RegExp(regex); while ((match = localRegex.exec(r.months)) !== null) { const y = parseInt(match[1]); const ms = match[2].split(',').map(Number); ms.forEach(m => paidMap.set(`${y}-${m}`, dateStr)); } } }); const currentPickerYear = window.appState.pickerYear; for(let m=1; m<=12; m++) { const key = `${currentPickerYear}-${m}`; if(paidMap.has(key)) { const btn = document.getElementById(`mbtn-${m}`); if(btn) { btn.classList.add('paid'); btn.setAttribute('data-date', paidMap.get(key)); if(window.appState.selectedMonthsSet.has(key)) { window.appState.selectedMonthsSet.delete(key); btn.classList.remove('selected'); } } } } window.updateSelectedMonthsInput(); const cust = window.appState.customers.find(c => c.address === address); if(cust) { window.appState.currentBaseAmount = cust.amount; if(cust.floor) document.getElementById('inputFloor').value = cust.floor; if(cust.category) window.setServiceCategory(cust.category); } else { window.appState.currentBaseAmount = 0; } };
window.setCollector = function(name) { 
    window.appState.currentCollector = name; 
    const tabs = { '子晴': 'tab-zih-cing', '子涵': 'tab-zih-han', '宗敬': 'tab-zong-jing' }; 
    const activeClasses = { '子晴': 'active-zih-cing', '子涵': 'active-zih-han', '宗敬': 'active-zong-jing' }; 
    const themeColors = { '子晴': 'bg-[#c2a992]', '子涵': 'bg-[#ff99ac]', '宗敬': 'bg-sky-400' }; 
    const btnColors = { '子晴': 'bg-[#c2a992] text-white', '子涵': 'bg-[#ff99ac] text-white', '宗敬': 'bg-sky-400 text-white' }; 
    const qsColors = { '子晴': 'bg-[#a38e7a]', '子涵': 'bg-pink-400', '宗敬': 'bg-sky-500' }; 
    const cardColors = { '子晴': 'border-[#e6dbd0]', '子涵': 'border-[#ffc1cc]', '宗敬': 'border-sky-300' }; 
    const icons = { '子晴': '🎠', '子涵': '🌸', '宗敬': '☁️' }; 
    Object.values(tabs).forEach(id => { const el = document.getElementById(id); el.classList.remove('active-zih-cing', 'active-zih-han', 'active-zong-jing', 'bg-white', 'text-gray-800'); el.classList.add('text-gray-400'); }); 
    document.getElementById(tabs[name]).classList.add(activeClasses[name]); 
    document.getElementById(tabs[name]).classList.remove('text-gray-400'); 
    document.getElementById('mainHeader').className = `${themeColors[name]} text-white pt-safe sticky top-0 z-20 shadow-lg transition-colors duration-300`; 
    document.getElementById('addBtn').className = `w-full btn-primary py-4 rounded-xl text-lg font-bold shadow-lg shadow-gray-300 flex justify-center items-center gap-2 transition-all active:scale-95 ${btnColors[name]}`; 
    document.getElementById('quickSelectBtn').className = `${qsColors[name]} text-white text-sm px-4 py-2 rounded-lg shadow active:scale-95 flex items-center transition-all`; 
    const card = document.getElementById('entryCard'); 
    card.className = `card p-5 border-t-4 transition-colors duration-300 ${cardColors[name]}`; 
    document.getElementById('listTitleName').innerText = name; 
    document.getElementById('listTitleIcon').innerText = icons[name]; 
    document.getElementById('settlePageTitle').innerText = `${name} 的薪水結算`; 
    
    // NEW: 切換收費員時，強制更新總金額顯示
    window.updateSummary();
    window.renderPendingList(); // 待收清單也要跟著變
    window.renderRecords();     // 下方的最近紀錄也要變
    window.renderManageCustomerList(); // 管理列表也要變
};
window.setServiceCategory = function(cat) { window.appState.currentServiceCategory = cat; const input = document.getElementById('inputServiceType'); if(input) input.value = cat; const btnStairs = document.getElementById('btn-cat-stairs'); const btnTank = document.getElementById('btn-cat-tank'); if (btnStairs && btnTank) { btnStairs.className = 'service-btn p-3 rounded-xl bg-orange-50 text-orange-400 font-bold flex justify-center items-center gap-2 shadow-sm'; btnTank.className = 'service-btn p-3 rounded-xl bg-cyan-50 text-cyan-400 font-bold flex justify-center items-center gap-2 shadow-sm'; if(cat === 'stairs') { btnStairs.classList.add('active', 'text-orange-700', 'border-orange-200'); btnStairs.classList.remove('text-orange-400'); } else { btnTank.classList.add('active', 'text-cyan-700', 'border-cyan-200'); btnTank.classList.remove('text-cyan-400'); } } };
window.setEditCustCategory = function(cat) { document.getElementById('editCustCategory').value = cat; const s = document.getElementById('edit-cat-stairs'); const t = document.getElementById('edit-cat-tank'); s.className = 'p-2 rounded border text-sm font-bold bg-gray-50 text-gray-400 border-gray-200'; t.className = 'p-2 rounded border text-sm font-bold bg-gray-50 text-gray-400 border-gray-200'; if(cat === 'stairs') s.className = 'p-2 rounded border text-sm font-bold bg-orange-100 text-orange-800 border-orange-200'; else t.className = 'p-2 rounded border text-sm font-bold bg-cyan-100 text-cyan-800 border-cyan-200'; };
window.openPendingMonthPicker = function(itemId, currentStr) { window.appState.pendingMonthTargetId = itemId; window.appState.modalPickerYear = 114; window.appState.tempModalSet = new Set(); const regex = /(\d+)年\s*([0-9,]+)/g; let match; while ((match = regex.exec(currentStr)) !== null) { const y = parseInt(match[1]); const ms = match[2].split(',').map(Number); ms.forEach(m => window.appState.tempModalSet.add(`${y}-${m}`)); } renderModalMonthGrid(); document.getElementById('monthPickerModal').classList.remove('hidden'); };
window.changeModalYear = function(delta) { window.appState.modalPickerYear += delta; renderModalMonthGrid(); };
function renderModalMonthGrid() { const y = window.appState.modalPickerYear; document.getElementById('modalYearDisplay').innerText = `${y}年`; document.getElementById('modalYearDisplaySpan').innerText = `${y}年`; const grid = document.getElementById('modalMonthGrid'); grid.innerHTML = ''; for(let i=1; i<=12; i++) { const key = `${y}-${i}`; const btn = document.createElement('button'); const isSelected = window.appState.tempModalSet.has(key); btn.className = `month-btn ${isSelected ? 'selected' : ''} p-2 rounded text-center`; btn.innerText = `${i}月`; btn.onclick = function() { if(window.appState.tempModalSet.has(key)) { window.appState.tempModalSet.delete(key); this.classList.remove('selected'); } else { window.appState.tempModalSet.add(key); this.classList.add('selected'); } }; grid.appendChild(btn); } }
window.closeMonthPickerModal = function(e) { if(e && e.target !== e.currentTarget) return; document.getElementById('monthPickerModal').classList.add('hidden'); };
window.applyModalMonths = function() { const groups = {}; window.appState.tempModalSet.forEach(key => { const [y, m] = key.split('-').map(Number); if(!groups[y]) groups[y] = []; groups[y].push(m); }); const parts = []; Object.keys(groups).sort().forEach(y => { const months = groups[y].sort((a,b)=>a-b).join(','); parts.push(`${y}年 ${months}月`); }); const targetId = window.appState.pendingMonthTargetId; if(targetId) { document.getElementById(`p-months-${targetId}`).value = parts.join(', '); updateDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'pending', targetId), { months: parts.join(', ') }); } closeMonthPickerModal(null); };
window.openHistory = function(address) { const list = document.getElementById('historyList'); const title = document.getElementById('historyTitle'); title.innerText = address; list.innerHTML = ''; const history = window.appState.records.filter(r => r.address === address); if(history.length === 0) { list.innerHTML = '<div class="text-center text-gray-400 py-10">尚無此地址的紀錄</div>'; } else { history.forEach(h => { const d = new Date(h.date); const dateStr = `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`; let typeText = '現金'; if(h.type === 'transfer') typeText = '匯款'; if(h.type === 'linepay') typeText = 'LinePay'; if(h.type === 'dad') typeText = '匯給爸爸'; const row = document.createElement('div'); row.className = 'p-3 border-b border-gray-100 flex justify-between items-center'; row.innerHTML = ` <div> <div class="text-sm font-bold text-gray-800">${dateStr} <span class="text-xs text-gray-500">(${h.collector})</span></div> <div class="text-xs text-blue-500">${h.months || '未填月份'}</div> </div> <div class="text-right"> <div class="font-bold text-emerald-600">$${h.amount}</div> <div class="text-xs text-gray-400">${typeText}</div> </div> `; list.appendChild(row); }); } document.getElementById('historyModal').classList.remove('hidden'); };
window.closeHistory = function(e) { if(e && e.target !== e.currentTarget) return; document.getElementById('historyModal').classList.add('hidden'); };
window.renderCustomerSettings = function() { const list = document.getElementById('customerListSettings'); const current = window.appState.currentCollector; const customers = window.appState.customers.filter(c => (c.collector === current) || (!c.collector && current === '子晴') ); list.innerHTML = ''; if(customers.length === 0) { list.innerHTML = `<div class="text-center text-gray-400 text-xs py-2">尚未建立 ${current} 的常用客戶</div>`; return; } customers.forEach(c => { const div = document.createElement('div'); div.className = 'flex justify-between items-center p-3 bg-white rounded-lg border border-gray-100 mb-2 shadow-sm'; const catIcon = c.category === 'tank' ? '💧' : '🪜'; 
const dateTag = c.serviceDate ? `<span class="ml-1 text-[10px] bg-gray-100 text-gray-500 px-1 rounded">${c.serviceDate.slice(5)}</span>` : '';
div.innerHTML = ` <div class="text-sm"> <div class="font-bold text-gray-800"><span class="mr-1">${catIcon}</span> ${c.address} ${dateTag} <span class="text-gray-400 text-xs font-normal">${c.floor || '不固定'}</span></div> <div class="text-emerald-600 font-bold">$${c.amount}</div> </div> <div class="flex"> <button type="button" onclick="openHistory('${c.address}')" class="text-orange-400 hover:text-orange-600 px-2 py-2"><i class="fa-solid fa-clock-rotate-left"></i></button> <button type="button" onclick="openEditCustomerModal('${c.id}', '${c.address}', ${c.amount}, '${c.floor || ''}', '${c.category || 'stairs'}', '${c.serviceDate || ''}')" class="text-gray-400 hover:text-blue-500 px-2 py-2"><i class="fa-solid fa-pen"></i></button> <button type="button" onclick="deleteCustomer('${c.id}')" class="text-gray-300 hover:text-red-500 px-2 py-2"><i class="fa-solid fa-trash-can"></i></button> </div> `; list.appendChild(div); }); };
// NEW: 強化 renderCustomerSelect，確保只顯示當前收費員的地址
window.renderCustomerSelect = function() { 
    const list = document.getElementById('customerSelectList'); 
    const search = document.getElementById('customerSearch').value.toLowerCase(); 
    const current = window.appState.currentCollector; 
    
    // 關鍵過濾邏輯：只顯示屬於 current 的，或者沒有 collector 且 current 是子晴的
    const customers = window.appState.customers.filter(c => (c.collector === current) || (!c.collector && current === '子晴') ); 
    
    // 排序依照 order
    customers.sort((a, b) => (a.order || 0) - (b.order || 0));

    list.innerHTML = ''; 
    const filtered = customers.filter(c => c.address.toLowerCase().includes(search)); 
    document.getElementById('customerModalCollector').innerText = current; 
    
    if(filtered.length === 0 && search.length > 0) { 
        const btn = document.createElement('button'); 
        btn.className = 'w-full p-4 bg-blue-50 text-blue-600 rounded-xl font-bold flex items-center justify-center border border-blue-200 active:bg-blue-100'; 
        btn.onclick = () => selectCustomer(search, '', '', 'stairs'); 
        btn.innerHTML = `<i class="fa-solid fa-plus mr-2"></i> 直接填寫：${search}`; 
        list.appendChild(btn); 
        return; 
    } 
    filtered.forEach(c => { 
        const lastRec = window.appState.records.find(r => r.address === c.address); 
        let lastInfo = '尚無紀錄'; 
        if(lastRec) { 
            const d = new Date(lastRec.date); 
            lastInfo = `上次：${d.getMonth()+1}/${d.getDate()} (${lastRec.months || '?'}) - ${lastRec.collector}`; 
        } 
        const btn = document.createElement('button'); 
        btn.className = 'list-btn w-full p-3 bg-gray-50 border border-gray-100 rounded-xl flex justify-between items-center text-left mb-2 active:bg-blue-50'; 
        btn.onclick = () => selectCustomer(c.address, c.floor, c.amount, c.category); 
        const catIcon = c.category === 'tank' ? '💧' : '🪜'; 
        btn.innerHTML = ` <div> <div class="font-bold text-gray-800 text-lg"><span class="mr-1">${catIcon}</span>${c.address} <span class="text-sm font-normal text-gray-500">${c.floor || ''}</span></div> <div class="text-xs text-gray-400 mt-1">${lastInfo}</div> </div> <div class="font-bold text-emerald-600">$${c.amount}</div> `; 
        list.appendChild(btn); 
    }); 
};
window.selectCustomer = function(addr, floor, amount, category) { document.getElementById('inputAddress').value = addr; document.getElementById('inputFloor').value = floor || ''; document.getElementById('inputAmount').value = amount || ''; if(category) window.setServiceCategory(category); window.checkPaidStatus(addr); closeCustomerSelect(null); showToast("已填入資料"); 
    const history = window.appState.records.filter(r => r.address === addr).sort((a,b) => b.date.localeCompare(a.date));
    if (history.length > 0) {
        const last = history[0];
        const lastFloor = last.floor ? `${last.floor}` : '無樓層';
        const d = new Date(last.date);
        const lastDate = `${d.getMonth()+1}/${d.getDate()}`;
        window.showToast(`ℹ️ 上次紀錄：${lastDate} (${lastFloor})`, 4000);
    }
};

// --- 13. Auto-Complete (New Helper) ---
window.updateAddressSuggestions = function(customers) {
    const dataList = document.getElementById('addressSuggestions');
    if(!dataList) return;
    dataList.innerHTML = ''; // 清空舊的
    const uniqueAddresses = new Set(customers.map(c => c.address));
    uniqueAddresses.forEach(addr => {
        const option = document.createElement('option');
        option.value = addr;
        dataList.appendChild(option);
    });
};

window.showBreakdown = function(type) {
    const list = document.getElementById('breakdownList');
    const modal = document.getElementById('breakdownModal');
    const title = document.getElementById('breakdownTitle');
    const totalEl = document.getElementById('breakdownTotal');
    const dateRangeEl = document.getElementById('breakdownDateRange');
    const monthPicker = document.getElementById('settleMonthPicker');
    const current = window.appState.currentCollector;
    let sDate = '', eDate = '', rangeText = '全部時間';
    if(monthPicker && monthPicker.value) {
        const [y, m] = monthPicker.value.split('-');
        sDate = `${y}-${m}-01`;
        eDate = `${y}-${m}-${new Date(y, m, 0).getDate()}`;
        rangeText = `${y}年 ${m}月`;
    }
    let filteredRecords = window.appState.records.filter(r => {
        if (sDate && r.date < sDate) return false;
        if (eDate && r.date > eDate) return false;
        let col = r.collector;
        if(!col || (col !== '子晴' && col !== '子涵' && col !== '宗敬')) col = '其他';
        if (col !== current) return false;

        if (type === 'no_receipt') return r.status === 'no_receipt';
        if (type === 'no_payment') return r.status === 'no_payment';

        if (r.status === 'no_payment') return false; 
        return r.type === type;
    });

    if(type === 'cash') title.innerText = '現金明細';
    else if(type === 'transfer') title.innerText = '匯款明細';
    else if(type === 'no_receipt') title.innerText = '欠收據清單';
    else if(type === 'no_payment') title.innerText = '欠匯款清單';
    else title.innerText = '明細';

    dateRangeEl.innerText = rangeText;
    list.innerHTML = '';
    let total = 0;
    if(filteredRecords.length === 0) {
        list.innerHTML = '<div class="text-center text-gray-400 py-4">無資料</div>';
    } else {
        filteredRecords.forEach(r => {
            const amount = parseInt(r.amount) || 0;
            total += amount;
            const d = new Date(r.date);
            const dateStr = `${d.getMonth()+1}/${d.getDate()}`;
            const div = document.createElement('div');
            div.className = 'flex justify-between items-center p-2 bg-gray-50 border border-gray-100 rounded text-sm';
            div.innerHTML = ` <div class="flex items-center gap-2"> <span class="text-gray-400 font-mono text-xs w-10">${dateStr}</span> <span class="text-gray-700 font-bold">${r.address}</span> </div> <span class="text-emerald-600 font-bold">$${amount.toLocaleString()}</span> `;
            list.appendChild(div);
        });
    }
    totalEl.innerText = `$${total.toLocaleString()}`;
    modal.classList.remove('hidden');
};
window.closeBreakdownModal = function(e) { if(e && e.target !== e.currentTarget) return; document.getElementById('breakdownModal').classList.add('hidden'); };
window.changeSettleMonth = function(delta) {
    const picker = document.getElementById('settleMonthPicker');
    if(!picker.value) return;
    const [y, m] = picker.value.split('-').map(Number);
    const newDate = new Date(y, m - 1 + delta, 1); 
    const newY = newDate.getFullYear();
    const newM = String(newDate.getMonth() + 1).padStart(2, '0');
    picker.value = `${newY}-${newM}`;
    window.updateSummary();
};

// NEW: 結算邏輯升級 - 支援多筆支出
window.addExpenseRow = function(name='', amt='') {
    const div = document.createElement('div');
    div.className = 'flex gap-2 items-center expense-row';
    div.innerHTML = `
        <input type="text" value="${name}" placeholder="項目" class="exp-name w-1/2 p-2 border rounded text-sm bg-white" oninput="window.saveExpenses(); window.updateSummary();">
        <input type="number" value="${amt}" placeholder="$" class="exp-amt flex-1 p-2 border rounded text-sm font-bold text-gray-700 bg-white" oninput="window.saveExpenses(); window.updateSummary();">
        <button type="button" onclick="this.parentElement.remove(); window.saveExpenses(); window.updateSummary();" class="text-red-400 p-2 hover:bg-red-50 rounded"><i class="fa-solid fa-minus"></i></button>
    `;
    document.getElementById('expenseList').appendChild(div);
};

window.saveExpenses = function() {
    const rows = document.querySelectorAll('.expense-row');
    const data = Array.from(rows).map(row => ({
        name: row.querySelector('.exp-name').value,
        amount: row.querySelector('.exp-amt').value
    }));
    localStorage.setItem('cleaning_app_expenses_v2', JSON.stringify(data));
};

window.updateSummary = function() { 
    let totalCashAll = 0, totalTransferAll = 0, totalLinePayAll = 0, totalDadAll = 0; 
    let totalCashMe = 0, totalTransferMe = 0, totalLinePayMe = 0, totalDadMe = 0; 
    let breakdown = { '子晴': { cash: 0, transfer: 0 }, '子涵': { cash: 0, transfer: 0 }, '宗敬': { cash: 0, transfer: 0 }, '其他': { cash: 0, transfer: 0 } }; 
    let catStats = { 'stairs': 0, 'tank': 0 }; 
    let pendingReceiptCount = 0; 
    let pendingPaymentCount = 0; 
    const current = window.appState.currentCollector; 
    const monthPicker = document.getElementById('settleMonthPicker');
    let sDate = '', eDate = '';
    if(monthPicker && monthPicker.value) {
        const [y, m] = monthPicker.value.split('-');
        sDate = `${y}-${m}-01`;
        const lastDay = new Date(y, m, 0).getDate();
        eDate = `${y}-${m}-${lastDay}`;
    }
    window.appState.records.forEach(r => { 
        if (sDate && r.date < sDate) return;
        if (eDate && r.date > eDate) return;
        let col = r.collector; 
        if(!col || (col !== '子晴' && col !== '子涵' && col !== '宗敬')) { col = '其他'; if (r.collector === '我') col = '其他'; } 
        if (col === current) { 
            if (r.status === 'no_receipt') pendingReceiptCount++; 
            if (r.status === 'no_payment') pendingPaymentCount++; 
        } 
        if (r.status === 'no_payment') return; 
        const amt = parseInt(r.amount) || 0;
        if (r.type === 'cash') { totalCashAll += amt; if (col === current) totalCashMe += amt; if (breakdown[col]) breakdown[col].cash += amt; } 
        else if (r.type === 'transfer') { totalTransferAll += amt; if (col === current) totalTransferMe += amt; if (breakdown[col]) breakdown[col].transfer += amt; } 
        else if (r.type === 'linepay') { totalLinePayAll += amt; if (col === current) totalLinePayMe += amt; } 
        else if (r.type === 'dad') { totalDadAll += amt; if (col === current) totalDadMe += amt; } 
        const cat = r.category === 'tank' ? 'tank' : 'stairs'; 
        catStats[cat] += amt; 
    }); 
    const grandTotalMe = totalCashMe + totalTransferMe + totalLinePayMe + totalDadMe; 
    const userHolding = totalCashMe + totalTransferMe + totalLinePayMe; 
    const fmt = (n) => `$${n.toLocaleString()}`; 
    document.getElementById('headerCashTotal').innerText = fmt(totalCashMe + totalLinePayMe); 
    document.getElementById('headerTransferTotal').innerText = fmt(totalTransferMe); 
    document.getElementById('headerGrandTotal').innerText = fmt(grandTotalMe); 
    document.getElementById('settleCash').innerText = fmt(totalCashMe); 
    document.getElementById('settleTransfer').innerText = fmt(totalTransferMe); 
    document.getElementById('settleLinePay').innerText = fmt(totalLinePayMe); 
    document.getElementById('settleDad').innerText = fmt(totalDadMe); 
    document.getElementById('settleTotal').innerText = fmt(grandTotalMe); 
    
    // NEW: 計算總扣除額
    let totalDeduction = 0;
    document.querySelectorAll('.exp-amt').forEach(input => totalDeduction += (parseInt(input.value) || 0));
    document.getElementById('totalExpensesDisplay').innerText = fmt(totalDeduction);

    const finalToDad = userHolding - totalDeduction; 
    document.getElementById('finalToDad').innerText = fmt(finalToDad); 
    
    document.getElementById('categoryBreakdown').innerHTML = ` <div class="bg-white p-3 rounded-lg border border-orange-200 text-center"> <div class="text-xs text-orange-600 font-bold mb-1">🪜 洗樓梯 (全部)</div> <div class="text-xl font-bold text-gray-800">${fmt(catStats.stairs)}</div> </div> <div class="bg-white p-3 rounded-lg border border-cyan-200 text-center"> <div class="text-xs text-cyan-600 font-bold mb-1">💧 洗水塔 (全部)</div> <div class="text-xl font-bold text-gray-800">${fmt(catStats.tank)}</div> </div> `; 
    
    const warningContainer = document.getElementById('settleWarnings'); 
    warningContainer.innerHTML = ''; 
    if (pendingReceiptCount > 0 || pendingPaymentCount > 0) { 
        warningContainer.classList.remove('hidden'); 
        if (pendingReceiptCount > 0) { 
            warningContainer.innerHTML += `<div onclick="showBreakdown('no_receipt')" class="bg-red-100 text-red-800 p-3 rounded-lg text-sm font-bold flex items-center cursor-pointer hover:bg-red-200 transition-colors"><i class="fa-solid fa-triangle-exclamation mr-2"></i> 您有 ${pendingReceiptCount} 筆帳款還沒給收據！(點擊查看)</div>`; 
        } 
        if (pendingPaymentCount > 0) { 
            warningContainer.innerHTML += `<div onclick="showBreakdown('no_payment')" class="bg-orange-100 text-orange-800 p-3 rounded-lg text-sm font-bold flex items-center cursor-pointer hover:bg-orange-200 transition-colors"><i class="fa-solid fa-hourglass-half mr-2"></i> 您有 ${pendingPaymentCount} 筆匯款尚未確認入帳！(點擊查看)</div>`; 
        } 
    } else { warningContainer.classList.add('hidden'); } 
    
    let breakdownHtml = ''; 
    ['子晴', '子涵', '宗敬'].forEach(p => { if(p !== current) { breakdownHtml += `<div class="flex justify-between text-xs text-gray-500 border-b border-gray-100 py-1"><span>${p}</span><span>現:${fmt(breakdown[p].cash)} / 匯:${fmt(breakdown[p].transfer)}</span></div>`; } }); 
    document.getElementById('collectorBreakdown').innerHTML = breakdownHtml; 
};
window.clearSettleDates = function() { document.getElementById('settleStartDate').value = ''; document.getElementById('settleEndDate').value = ''; window.updateSummary(); };
window.calculateSettlement = function() { window.updateSummary(); };
window.addTag = function(text) { const el = document.getElementById('inputNote'); el.value = el.value ? el.value + `，${text}` : text; };
window.showToast = function(msg, duration = 2000) { const t = document.getElementById('toast'); t.innerText = msg; t.style.display = 'block'; t.style.opacity = '1'; t.style.transform = 'translate(-50%, 0)'; setTimeout(() => { t.style.display = 'none'; }, duration); };
window.exportData = function() { const data = window.appState; const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `雲端收費備份_${new Date().toISOString().slice(0,10)}.json`; a.click(); };
window.printAllRecords = function() { const records = window.appState.records; if (records.length === 0) { window.showToast("目前沒有紀錄可列印"); return; } let totalCash = 0; let totalTransfer = 0; let totalLinePay = 0; let totalDad = 0; let totalAmount = 0; records.forEach(r => { if (r.status === 'no_payment') return; if(r.type === 'cash') totalCash += r.amount; else if(r.type === 'transfer') totalTransfer += r.amount; else if(r.type === 'linepay') totalLinePay += r.amount; else if(r.type === 'dad') totalDad += r.amount; totalAmount += r.amount; }); const dateStr = new Date().toLocaleDateString('zh-TW', {year: 'numeric', month: '2-digit', day: '2-digit'}); let html = ` <div class="print-title">清潔收費總報表</div> <div style="text-align:center; margin-bottom:10px;">列印日期：${dateStr}</div> <div class="print-summary"> <div> <div style="font-size:12px;">本期總收入</div> <div style="font-size:16px; font-weight:bold;">$${totalAmount.toLocaleString()}</div> </div> <div> <div style="font-size:12px;">現金總額</div> <div style="font-size:16px; font-weight:bold;">$${totalCash.toLocaleString()}</div> </div> <div> <div style="font-size:12px;">匯款總額</div> <div style="font-size:16px; font-weight:bold;">$${totalTransfer.toLocaleString()}</div> </div> <div> <div style="font-size:12px;">LinePay</div> <div style="font-size:16px; font-weight:bold;">$${totalLinePay.toLocaleString()}</div> </div> <div> <div style="font-size:12px;">已匯給爸爸</div> <div style="font-size:16px; font-weight:bold;">$${totalDad.toLocaleString()}</div> </div> </div> <table class="print-table"> <thead> <tr> <th width="12%">日期</th> <th width="10%">經手人</th> <th width="25%">地址/客戶</th> <th width="10%">項目</th> <th width="10%">金額</th> <th width="10%">方式</th> <th width="13%">月份</th> <th width="10%">備註</th> </tr> </thead> <tbody> `; records.forEach(r => { const d = new Date(r.date); const dStr = `${d.getMonth()+1}/${d.getDate()}`; const cat = r.category === 'tank' ? '水塔' : '樓梯'; let type = '現金'; if(r.type === 'transfer') type = '匯款'; if(r.type === 'linepay') type = 'LinePay'; if(r.type === 'dad') type = '已匯爸'; let note = r.note || ''; if(r.status === 'no_receipt') note += ' (欠收據)'; if(r.status === 'no_payment') note += ' (未入帳)'; const collector = r.collector || '子晴'; const floor = r.floor ? `(${r.floor})` : ''; html += ` <tr> <td>${dStr}</td> <td>${collector}</td> <td>${r.address} ${floor}</td> <td>${cat}</td> <td style="font-weight:bold;">$${r.amount.toLocaleString()}</td> <td>${type}</td> <td style="font-size:11px;">${r.months || ''}</td> <td style="font-size:11px;">${note}</td> </tr> `; }); html += ` </tbody> </table> `; document.getElementById('printContainer').innerHTML = html; window.print(); };
window.openAddCustomerModal = function() { window.appState.editingCustomerId = null; document.getElementById('customerModalTitle').innerHTML = '<i class="fa-solid fa-user-plus text-green-600"></i> 新增常用客戶'; document.getElementById('newCustAddr').value = ''; document.getElementById('newCustAmt').value = ''; document.getElementById('newCustFloor').value = ''; document.getElementById('newCustServiceDate').value = ''; document.getElementById('newCustNote').value = ''; document.getElementById('addCustomerModal').classList.remove('hidden'); window.setEditCustCategory('stairs'); setTimeout(() => document.getElementById('newCustAddr').focus(), 100); };
window.openEditCustomerModal = function(id, addr, amt, floor, cat) { window.appState.editingCustomerId = id; document.getElementById('customerModalTitle').innerHTML = '<i class="fa-solid fa-pen-to-square text-blue-600"></i> 編輯常用客戶'; document.getElementById('newCustAddr').value = addr; document.getElementById('newCustAmt').value = amt; document.getElementById('newCustFloor').value = floor; window.setEditCustCategory(cat || 'stairs'); document.getElementById('addCustomerModal').classList.remove('hidden'); };
window.closeAddCustomerModal = function(e) { if(e && e.target !== e.currentTarget) return; document.getElementById('addCustomerModal').classList.add('hidden'); };
window.openCustomerSelect = function() { window.renderCustomerSelect(); document.getElementById('customerModal').classList.remove('hidden'); };
window.closeCustomerSelect = function(e) { if(e && e.target !== e.currentTarget) return; document.getElementById('customerModal').classList.add('hidden'); };

window.onload = function() {
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];
    document.getElementById('inputDate').value = dateStr;
    document.getElementById('headerDate').innerText = `${today.getMonth() + 1}/${today.getDate()} (週${['日','一','二','三','四','五','六'][today.getDay()]})`;
    
    // NEW: 載入多筆支出
    const savedExpenses = localStorage.getItem('cleaning_app_expenses_v2');
    if(savedExpenses) {
        try {
            const data = JSON.parse(savedExpenses);
            if(Array.isArray(data) && data.length > 0) {
                data.forEach(item => window.addExpenseRow(item.name, item.amount));
            } else {
                window.addExpenseRow('我的薪水', ''); // 預設一行
            }
        } catch(e) { window.addExpenseRow('我的薪水', ''); }
    } else {
        window.addExpenseRow('我的薪水', '');
    }
    
    if(document.getElementById('inputServiceType')) {
        window.setServiceCategory('stairs');
    }
    window.setCollector('子晴');
    window.renderMonthPicker();
    
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    document.getElementById('settleMonthPicker').value = `${y}-${m}`;
    
    setTimeout(() => { window.updateSummary(); }, 500);
};
