import { timerModule } from './js/timer.module.js';
import { pickerModule } from './js/picker.module.js';
import { studentModule } from './js/student.module.js';
import { configModule } from './js/config.module.js';
import { storageModule } from './js/storage.module.js';
import { printModule } from './js/print.module.js';
import { P2PSyncManager } from './p2p-sync.js';
import { sessionModule } from './js/session.module.js';

// Lắng nghe sự kiện Alpine khởi tạo
document.addEventListener('alpine:init', () => {
    
    // Đăng ký component examApp chuẩn theo Alpine 3.x
    Alpine.data('examApp', () => ({
        activeTab: 'timer',
        currentSystemTime: '',
        isZaloBrowser: false,
        showAddStudentModal: false,
        showGradingModal: false,
        activeStudent: null,
        targetStudentId: null,
        newLogText: '',
        toasts: [],
        confirmModal: { show: false, title: '', message: '', onConfirm: null },

        // Trạng thái cổng Đồng bộ trực tiếp P2P
        syncState: {
            showModal: false,
            status: 'disconnected', // 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
            role: null,             // 'host' | 'guest' | null
            roomCode: '',
            inputCode: '',
            peerCount: 0
        },
        _syncManager: null,
        _isApplyingRemote: false,
        _lastSavedStudents: [],

        // Trạng thái Quản lý & Lưu trữ nhiều suất thi
        sessionState: {
            showModal: false,
            currentSessionId: null,
            newPassword: '',
            savedSessions: [],
            authPrompt: {
                show: false,
                action: '',
                session: null,
                inputPassword: '',
                errorMsg: ''
            }
        },
        
        timer: { timeLeft: 60 * 60, isRunning: false, intervalId: null },
        config: {
            examTitle: 'DANH SÁCH SINH VIÊN DỰ THI KTHP',
            academicYear: '2026-2027',
            subjectName: 'Sinh Học Đại Cương',
            subjectCode: 'BIO101',
            subClass: 'C1',
            credits: '1',
            semester: '1',
            examAttempt: '1',
            examTime: '07h00 - Ngày 08/11/2026',
            durationMinutes: 45,
            roomName: '116',
            facility: 'K7/25 Quang Trung',
            examiner1: 'HUỲNH NGỌC THÀNH',
            examiner2: '',
            sections: [
                { title: 'Tiêu bản tự chọn', maxScore: 5, note: 'Vẽ hình và trình bày', rounding: 'none', lastImportInfo: '' },
                { title: 'Bài thi chỉ định', maxScore: 5, note: 'Quan sát đặc điểm', rounding: 'none', lastImportInfo: '' }
            ]
        },
        picker: { 
            rawExamList: "Đề 1\nĐề 2\nĐề 3\nĐề 4\nĐề 5\nĐề 6\nĐề 7\nĐề 8", 
            currentDisplay: "", 
            isSpinning: false, 
            targetStudentId: "",
            allowDuplicate: false 
        },
        students: [],
        newStudent: { mssv: '', hoLot: '', ten: '', className: '' },
        logs: [],

        initApp() {
            const ua = navigator.userAgent || '';
            if (/Zalo/i.test(ua)) {
                this.isZaloBrowser = true;
            }

            setInterval(() => { this.currentSystemTime = new Date().toLocaleTimeString('vi-VN'); }, 1000);
            this.loadFromLocalStorage();
            this._lastSavedStudents = JSON.parse(JSON.stringify(this.students || []));
            this.sessionState.savedSessions = sessionModule.loadAllSessions();

            if (!this.timer.timeLeft || this.timer.timeLeft <= 0) {
                this.timer.timeLeft = (this.config.durationMinutes || 45) * 60;
            }
            if (!this.isZaloBrowser) {
                this.initSyncModule();
            }
        },

        copyCurrentUrl() {
            navigator.clipboard.writeText(window.location.href);
            this.triggerToast('Đã sao chép đường dẫn! Hãy dán vào Chrome hoặc Safari.', 'success');
        },

        // Khởi tạo module đồng bộ P2P (WebRTC / PeerJS) có Auto-Reconnect & Smart Merge
        initSyncModule() {
            this._syncManager = new P2PSyncManager({
                prefix: 'SGS-EXAM-',
                getAppState: () => ({
                    config: JSON.parse(JSON.stringify(this.config)),
                    timer: {
                        timeLeft: this.timer.timeLeft,
                        isRunning: this.timer.isRunning
                    },
                    students: JSON.parse(JSON.stringify(this.students)),
                    picker: {
                        rawExamList: this.picker.rawExamList,
                        currentDisplay: this.picker.currentDisplay,
                        allowDuplicate: this.picker.allowDuplicate
                    },
                    logs: JSON.parse(JSON.stringify(this.logs))
                }),
                onStateReceived: (remote, meta = {}) => {
                    this._isApplyingRemote = true;
                    try {
                        this.mergeRemoteState(remote, meta);
                        storageModule.saveToLocalStorage(this);
                        this._lastSavedStudents = JSON.parse(JSON.stringify(this.students));
                    } finally {
                        this._isApplyingRemote = false;
                    }
                },
                onStatusChange: (info) => {
                    this.syncState.status = info.status;
                    this.syncState.role = info.role;
                    this.syncState.roomCode = info.roomCode || '';
                    this.syncState.peerCount = info.peerCount || 0;

                    if (info.joinUrl) {
                        this.$nextTick(() => {
                            const qrBox = document.getElementById('p2p-qrcode-box');
                            if (qrBox && window.QRCode) {
                                qrBox.innerHTML = '';
                                new window.QRCode(qrBox, { text: info.joinUrl, width: 160, height: 160 });
                            }
                        });
                    }
                },
                onToast: (msg, type) => this.triggerToast(msg, type)
            });

            this._syncManager.checkAutoJoinFromUrl();
        },

        stampStudentUpdates(prevStudents, nextStudents) {
            const now = Date.now();
            const prevMap = new Map((prevStudents || []).map(s => [s.id || s.mssv, s]));

            return (nextStudents || []).map(st => {
                const key = st.id || st.mssv;
                const old = prevMap.get(key);
                if (!old) {
                    return { ...st, updatedAt: st.updatedAt || now };
                }
                const changed =
                    old.isPresent !== st.isPresent ||
                    old.assignedExam !== st.assignedExam ||
                    old.totalScore !== st.totalScore ||
                    JSON.stringify(old.scores || []) !== JSON.stringify(st.scores || []);

                return {
                    ...st,
                    updatedAt: changed ? now : (st.updatedAt || old.updatedAt || now)
                };
            });
        },

        mergeRemoteState(remote, meta = {}) {
            const isHost = this.syncState.role === 'host';
            const isInitial = !!meta.isInitialSync;

            if (remote.config && (!isInitial || !isHost)) {
                Object.assign(this.config, remote.config);
            }

            if (remote.picker && (!isInitial || !isHost)) {
                Object.assign(this.picker, remote.picker);
            }

            if (remote.timer && (!isInitial || !isHost)) {
                this.timer.timeLeft = remote.timer.timeLeft;
                if (remote.timer.isRunning && !this.timer.isRunning) {
                    timerModule.toggleTimer(this);
                } else if (!remote.timer.isRunning && this.timer.isRunning) {
                    timerModule.toggleTimer(this);
                }
            }

            if (Array.isArray(remote.students)) {
                const mergedMap = new Map();

                this.students.forEach(localSt => {
                    const key = localSt.id || localSt.mssv;
                    mergedMap.set(key, { ...localSt, updatedAt: localSt.updatedAt || 0 });
                });

                remote.students.forEach(remoteSt => {
                    const key = remoteSt.id || remoteSt.mssv;
                    const localSt = mergedMap.get(key);
                    const remoteTime = remoteSt.updatedAt || 0;

                    if (!localSt || remoteTime >= (localSt.updatedAt || 0)) {
                        mergedMap.set(key, { ...remoteSt, updatedAt: remoteTime });
                    }
                });

                this.students = Array.from(mergedMap.values());
            }

            if (Array.isArray(remote.logs)) {
                const seen = new Set();
                const combined = [...this.logs, ...remote.logs].filter(item => {
                    const sig = `${item.time}|${item.text}`;
                    if (seen.has(sig)) return false;
                    seen.add(sig);
                    return true;
                });
                this.logs = combined;
            }
        },

        // Các hàm điều khiển nút bấm trong Modal Đồng bộ
        startLiveSyncHost() { this._syncManager?.startHost(); },
        joinLiveSyncRoom() { this._syncManager?.joinRoom(this.syncState.inputCode); },
        disconnectLiveSync() { this._syncManager?.disconnect(true); },
        copySyncCode() {
            if (!this.syncState.roomCode) return;
            navigator.clipboard.writeText(this.syncState.roomCode);
            this.triggerToast(`Đã sao chép mã phòng: ${this.syncState.roomCode}`, 'success');
        },
        broadcastSyncState() {
            if (!this._isApplyingRemote && this._syncManager) {
                this._syncManager.broadcast(this._syncManager.getAppState());
            }
        },

        // Các hàm điều khiển Quản lý & Lưu trữ Suất thi
        openSessionModal() {
            this.sessionState.savedSessions = sessionModule.loadAllSessions();
            this.sessionState.authPrompt = { show: false, action: '', session: null, inputPassword: '', errorMsg: '' };
            this.sessionState.showModal = true;
        },
        saveCurrentSession(isUpdate = false) {
            sessionModule.saveSession(this, isUpdate);
        },
        triggerSessionAction(sessionItem, actionType) {
            sessionModule.requestSessionAction(this, sessionItem, actionType);
        },
        verifySessionPassword() {
            sessionModule.verifyAndExecuteAuth(this);
        },
        exportCurrentSessionJson() {
            sessionModule.exportSessionToJson(this, null);
        },
        exportSpecificSessionJson(sessionItem) {
            sessionModule.exportSessionToJson(this, sessionItem);
        },
        importSessionJson(event) {
            sessionModule.importSessionFromJson(this, event);
        },

        triggerToast(message, type = 'info') {
            const id = Date.now();
            this.toasts.push({ id, message, type, visible: true });
            setTimeout(() => { this.toasts = this.toasts.filter(t => t.id !== id); }, 4000);
        },
        removeToast(id) { this.toasts = this.toasts.filter(t => t.id !== id); },
        executeConfirmAction() {
            if (typeof this.confirmModal.onConfirm === 'function') this.confirmModal.onConfirm();
            this.confirmModal.show = false;
        },
        toggleFullscreen() {
            if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
            else if (document.exitFullscreen) document.exitFullscreen();
        },

        // Timer actions
        toggleTimer() { timerModule.toggleTimer(this); this.broadcastSyncState(); },
        resetTimer() { timerModule.resetTimer(this); this.broadcastSyncState(); },
        adjustHours(amount) { timerModule.adjustHours(this, amount); this.broadcastSyncState(); },
        adjustMinutes(amount) { timerModule.adjustMinutes(this, amount); this.broadcastSyncState(); },
        addExtraMinutes(mins) { timerModule.addExtraMinutes(this, mins); this.broadcastSyncState(); },
        setQuickDuration(mins) { timerModule.setQuickDuration(this, mins); this.broadcastSyncState(); },
        formatTime(s) { return timerModule.formatTime(s); },
        addLog() { timerModule.addLog(this); this.broadcastSyncState(); },

        // Picker actions
        getExamListArray() { return pickerModule.getExamListArray(this); },
        getAvailableExams() { return this.getExamListArray(); },
        startRandomDraw() { pickerModule.startRandomDraw(this); },
        handleTargetStudentChange() {
            const totalExams = this.getExamListArray().length;
            const totalStudents = this.students.length;
            
            if (this.picker.targetStudentId === 'ALL' && totalExams < totalStudents && totalStudents > 0) {
                this.picker.allowDuplicate = true;
                this.triggerToast(`Số lượng đề (${totalExams}) ít hơn số SV (${totalStudents}). Đã tự động bật cho phép trùng đề!`, 'warning');
            }
        },

        // Student actions
        openGradingModal(st) { studentModule.openGradingModal(this, st); },
        calculateTotalScore(st) { studentModule.calculateTotalScore(this, st); },
        toggleAttendance(st) { studentModule.toggleAttendance(this, st); },
        saveManualStudent() { studentModule.saveManualStudent(this); },
        confirmDeleteStudent(st) { studentModule.confirmDeleteStudent(this, st); },

        // Chuẩn hóa Mã Sinh Viên (xử lý cả kiểu Number, String, dấu nháy đơn ', đuôi .0 và khoảng trắng)
        normalizeStudentId(val) {
            if (val === null || val === undefined) return '';
            let str = String(val).trim();
            // Bỏ dấu nháy đơn đầu chuỗi do Excel ép kiểu Text (VD: '32213504679)
            str = str.replace(/^'+/, '');
            // Bỏ đuôi .0 nếu bị đọc thành số thực (VD: 32213504679.0 -> 32213504679)
            if (/^\d+\.0+$/.test(str)) {
                str = str.replace(/\.0+$/, '');
            }
            return str.replace(/\s+/g, '').toUpperCase();
        },

        // Nạp & Quy đổi điểm từ file Excel (.xlsx, .xls) hoặc CSV (.csv) cho từng Phần thi
        handleSectionExcelScoreUpload(event, sectionIdx) {
            const file = event.target.files?.[0];
            if (!file) return;

            const section = this.config.sections[sectionIdx];
            if (!section) {
                event.target.value = '';
                return;
            }

            if (!this.students || this.students.length === 0) {
                this.triggerToast('Danh sách thí sinh đang trống! Vui lòng tải danh sách thí sinh trước.', 'warning');
                event.target.value = '';
                return;
            }

            if (!window.XLSX) {
                this.triggerToast('Không tìm thấy thư viện đọc bảng tính (SheetJS).', 'error');
                event.target.value = '';
                return;
            }

            const isCsv = file.name.toLowerCase().endsWith('.csv');
            const reader = new FileReader();

            reader.onload = (e) => {
                try {
                    // Đọc CSV theo chuỗi UTF-8 để giữ nguyên tiếng Việt và tự nhận diện dấu phẩy / chấm phẩy
                    const workbook = isCsv
                        ? window.XLSX.read(e.target.result, { type: 'string' })
                        : window.XLSX.read(new Uint8Array(e.target.result), { type: 'array' });

                    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                    const rows = window.XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });

                    if (rows.length <= 1) {
                        this.triggerToast('File bảng điểm không có dữ liệu thí sinh!', 'warning');
                        return;
                    }

                    // Map 1: Khớp chính xác chuỗi chuẩn hóa (VD: "0322135" hoặc "SV001")
                    // Map 2: Khớp dự phòng cho mã thuần số bị Excel cắt mất số 0 ở đầu (VD: "0322135" <-> 322135)
                    const exactScoreMap = new Map();
                    const numericFallbackMap = new Map();

                    for (let i = 1; i < rows.length; i++) {
                        const row = rows[i];
                        if (!row || row.length < 9) continue;

                        const normMssv = this.normalizeStudentId(row[2]); // Cột C: Mã Sinh Viên
                        if (!normMssv || normMssv === 'MÃSINHVIÊN' || normMssv === 'MSSV') continue;

                        const rawScoreStr = String(row[8] ?? '').trim().replace(',', '.'); // Cột I: Điểm số
                        const rawScore = parseFloat(rawScoreStr);

                        if (!isNaN(rawScore)) {
                            exactScoreMap.set(normMssv, rawScore);
                            if (/^\d+$/.test(normMssv)) {
                                const strippedZeros = normMssv.replace(/^0+/, '') || '0';
                                numericFallbackMap.set(strippedZeros, rawScore);
                            }
                        }
                    }

                    if (exactScoreMap.size === 0) {
                        this.triggerToast('Không đọc được dữ liệu hợp lệ ở Cột C (Mã SV) và Cột I (Điểm số)!', 'error');
                        return;
                    }

                    const maxSecScore = Number(section.maxScore) || 0;
                    const roundingMode = section.rounding || 'none';
                    let matchedCount = 0;
                    let absentWithScoreCount = 0;

                    this.students.forEach((st) => {
                        if (!Array.isArray(st.scores)) {
                            st.scores = new Array(this.config.sections.length).fill(0);
                        }
                        while (st.scores.length < this.config.sections.length) {
                            st.scores.push(0);
                        }

                        const normStMssv = this.normalizeStudentId(st.mssv);
                        let baseScore10 = null;

                        if (exactScoreMap.has(normStMssv)) {
                            baseScore10 = exactScoreMap.get(normStMssv);
                        } else if (/^\d+$/.test(normStMssv)) {
                            const strippedStZeros = normStMssv.replace(/^0+/, '') || '0';
                            if (numericFallbackMap.has(strippedStZeros)) {
                                baseScore10 = numericFallbackMap.get(strippedStZeros);
                            }
                        }

                        if (baseScore10 !== null) {
                            let converted = (baseScore10 / 10) * maxSecScore;

                            if (roundingMode === '0.1') {
                                converted = Math.round(converted * 10) / 10;
                            } else if (roundingMode === '0.25') {
                                converted = Math.round(converted * 4) / 4;
                            } else if (roundingMode === '0.5') {
                                converted = Math.round(converted * 2) / 2;
                            } else {
                                converted = Math.round(converted * 100) / 100;
                            }

                            converted = Math.max(0, Math.min(maxSecScore, converted));
                            st.scores[sectionIdx] = converted;

                            const sum = this.config.sections.reduce((acc, _, idx) => acc + (Number(st.scores[idx]) || 0), 0);
                            st.totalScore = Math.round(sum * 100) / 100;
                            st.updatedAt = Date.now();

                            matchedCount++;
                            if (!st.isPresent) absentWithScoreCount++;
                        }
                    });

                    section.lastImportInfo = `Đã nạp ${matchedCount}/${this.students.length} SV (${file.name})`;

                    this.logs.unshift({
                        time: new Date().toLocaleTimeString('vi-VN'),
                        text: `Nạp điểm [${section.title || 'Phần ' + (sectionIdx + 1)}]: khớp ${matchedCount}/${this.students.length} SV (thang ${maxSecScore}đ).`
                    });

                    this.saveToLocalStorage();

                    if (matchedCount === 0) {
                        this.triggerToast('Không có Mã Sinh Viên nào khớp với danh sách phòng thi!', 'warning');
                    } else if (absentWithScoreCount > 0) {
                        this.triggerToast(
                            `Đã cập nhật điểm cho ${matchedCount}/${this.students.length} SV (Lưu ý: có ${absentWithScoreCount} SV đang đánh dấu VẮNG nhưng có điểm!).`,
                            'warning'
                        );
                    } else {
                        this.triggerToast(
                            `Đã cập nhật điểm "${section.title || 'Phần ' + (sectionIdx + 1)}" cho ${matchedCount}/${this.students.length} thí sinh!`,
                            'success'
                        );
                    }
                } catch (err) {
                    console.error('Lỗi đọc file bảng điểm:', err);
                    this.triggerToast('Lỗi khi xử lý file bảng điểm Excel/CSV!', 'error');
                } finally {
                    event.target.value = '';
                }
            };

            if (isCsv) {
                reader.readAsText(file, 'UTF-8');
            } else {
                reader.readAsArrayBuffer(file);
            }
        },

        // Validation & Lưu Chấm điểm
        hasGradingError() {
            if (!this.activeStudent || !this.activeStudent.scores || !this.config.sections) return false;
            return this.config.sections.some((sec, idx) => {
                const score = Number(this.activeStudent.scores[idx]) || 0;
                return score > Number(sec.maxScore);
            });
        },
        
        saveGradingModal() {
            if (this.hasGradingError()) {
                this.triggerToast("Có phần thi nhập vượt quá điểm tối đa, vui lòng kiểm tra lại!", "error");
                return;
            }
        
            const target = this.students.find(s => s.id === this.targetStudentId || s.id === (this.activeStudent && this.activeStudent.id));
            if (target) {
                target.scores = [...this.activeStudent.scores];
                target.totalScore = this.activeStudent.totalScore;
                target.updatedAt = Date.now();
                
                this.saveToLocalStorage();
                this.triggerToast("Đã lưu bảng điểm thành công!", "success");
            }
        
            this.showGradingModal = false;
            this.activeStudent = null;
        },

        // Config actions
        getTotalPoints() { return configModule.getTotalPoints(this); },
        addSection() { configModule.addSection(this); },
        removeSection(idx) { configModule.removeSection(this, idx); },

        // Print A4 Sheet action
        printExamSheet() {
            printModule.printExamSheet(this);
        },

        // Storage & Excel actions
        downloadStudentTemplate() { storageModule.downloadStudentTemplate(); },
        handleStudentExcelUpload(e) { storageModule.handleStudentExcelUpload(this, e); },
        exportToExcelXLSX() { storageModule.exportToExcelXLSX(this); },
        
        clearLocalStorageDraft() {
            this.confirmModal = {
                show: true,
                title: "Xóa Bản Nháp",
                message: "Bạn có chắc chắn muốn xóa toàn bộ bản nháp và làm mới không?",
                onConfirm: () => {
                    localStorage.removeItem('EXAM_MONITOR_DATA_V5');
                    this.students = [];
                    this.logs = [];
                    this._lastSavedStudents = [];
                    this.sessionState.currentSessionId = null;
                    this.broadcastSyncState();
                    this.triggerToast("Đã xóa bản nháp thành công!", "info");
                }
            };
        },
        saveToLocalStorage() {
            if (!this._isApplyingRemote) {
                this.students = this.stampStudentUpdates(this._lastSavedStudents || [], this.students);
            }
            this._lastSavedStudents = JSON.parse(JSON.stringify(this.students));

            storageModule.saveToLocalStorage(this);
            this.broadcastSyncState();
        },
        loadFromLocalStorage() { storageModule.loadFromLocalStorage(this); },

        // Helpers
        getRemainingPercentage() {
            return Math.max(0, Math.min(100, (this.timer.timeLeft / ((this.config.durationMinutes || 45) * 60)) * 100));
        },
        getProgressColor() {
            const pct = this.getRemainingPercentage();
            if (pct > 50) return 'bg-emerald-500';
            if (pct > 20) return 'bg-amber-500';
            return 'bg-rose-600';
        },
        getTimerStatusText() { return this.timer.isRunning ? 'Đang chạy' : 'Tạm dừng'; }
    }));
});
