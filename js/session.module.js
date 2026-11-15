// ./js/session.module.js - Quản lý đa suất thi, bảo mật mật khẩu SHA-256 & Xuất/Nhập file .JSON

const STORAGE_KEY = 'EXAM_SAVED_SESSIONS_V1';

// Hàm băm mật khẩu SHA-256 (có dự phòng nếu mở file:// không qua HTTPS/localhost)
async function hashPassword(plainText) {
    const clean = (plainText || '').trim();
    if (!clean) return null;

    if (window.crypto && window.crypto.subtle) {
        const encoder = new TextEncoder();
        const data = encoder.encode('SGS_SALT_' + clean);
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // Fallback hash deterministic khi chạy offline qua giao thức file://
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    const str = 'SGS_SALT_' + clean;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

function sanitizeFilename(str) {
    return String(str || 'SuatThi')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'D')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

export const sessionModule = {
    // Đọc danh sách suất thi đã lưu từ localStorage
    loadAllSessions() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            const list = raw ? JSON.parse(raw) : [];
            return Array.isArray(list) ? list : [];
        } catch (e) {
            console.error('Lỗi đọc danh sách suất thi:', e);
            return [];
        }
    },

    persistAllSessions(list) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
        } catch (e) {
            throw new Error('Bộ nhớ trình duyệt đã đầy! Hãy xuất bớt suất thi cũ ra file .json và xóa bớt.');
        }
    },

    // Đóng gói dữ liệu suất thi hiện tại
    buildSessionPayload(app, customId = null, passwordHash = null) {
        const classLabel = `${app.config.subjectCode || ''} ${app.config.subClass || ''}`.trim() || 'Chưa đặt lớp';
        const nowStr = new Date().toLocaleString('vi-VN', {
            hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric'
        });

        return {
            id: customId || `SES_${Date.now()}`,
            examTime: app.config.examTime || 'Chưa đặt giờ thi',
            className: classLabel,
            subjectName: app.config.subjectName || 'Môn học chưa đặt',
            roomName: app.config.roomName || '',
            studentCount: (app.students || []).length,
            savedAt: nowStr,
            hasPassword: !!passwordHash,
            passwordHash: passwordHash || null,
            data: {
                config: JSON.parse(JSON.stringify(app.config)),
                students: JSON.parse(JSON.stringify(app.students || [])),
                picker: {
                    rawExamList: app.picker.rawExamList,
                    currentDisplay: app.picker.currentDisplay,
                    allowDuplicate: app.picker.allowDuplicate
                },
                logs: JSON.parse(JSON.stringify(app.logs || [])),
                timer: {
                    timeLeft: app.timer.timeLeft,
                    durationMinutes: app.config.durationMinutes || 45
                }
            }
        };
    },

    // Lưu suất thi mới hoặc cập nhật suất thi đang mở
    async saveSession(app, isUpdateExisting = false) {
        try {
            const list = this.loadAllSessions();
            const rawPass = (app.sessionState.newPassword || '').trim();
            let targetId = null;
            let finalHash = null;

            if (isUpdateExisting && app.sessionState.currentSessionId) {
                const existing = list.find(s => s.id === app.sessionState.currentSessionId);
                if (existing) {
                    targetId = existing.id;
                    // Nếu nhập mật khẩu mới thì cập nhật mật khẩu mới; nếu để trống thì giữ mật khẩu cũ
                    finalHash = rawPass ? await hashPassword(rawPass) : existing.passwordHash;
                }
            } else {
                finalHash = rawPass ? await hashPassword(rawPass) : null;
            }

            const record = this.buildSessionPayload(app, targetId, finalHash);

            if (targetId) {
                const idx = list.findIndex(s => s.id === targetId);
                list[idx] = record;
            } else {
                list.unshift(record);
            }

            this.persistAllSessions(list);
            app.sessionState.savedSessions = list;
            app.sessionState.currentSessionId = record.id;
            app.sessionState.newPassword = '';

            app.triggerToast(
                targetId
                    ? `Đã cập nhật suất thi "${record.className}"!`
                    : `Đã lưu suất thi mới "${record.className}"${record.hasPassword ? ' (có mật khẩu)' : ''}!`,
                'success'
            );
        } catch (err) {
            app.triggerToast(err.message || 'Không thể lưu suất thi!', 'error');
        }
    },

    // Yêu cầu mở hoặc xóa một suất thi (kiểm tra mật khẩu nếu có)
    requestSessionAction(app, sessionItem, actionType) {
        if (!sessionItem.hasPassword) {
            if (actionType === 'load') this.applySessionData(app, sessionItem);
            if (actionType === 'delete') this.deleteSessionById(app, sessionItem.id);
            return;
        }

        // Mở hộp nhập mật khẩu xác nhận ngay trong Modal
        app.sessionState.authPrompt = {
            show: true,
            action: actionType, // 'load' | 'delete' | 'import'
            session: sessionItem,
            inputPassword: '',
            errorMsg: ''
        };
    },

    // Xác thực mật khẩu khi mở/xóa/nhập file
    async verifyAndExecuteAuth(app) {
        const prompt = app.sessionState.authPrompt;
        if (!prompt.show || !prompt.session) return;

        const enteredHash = await hashPassword(prompt.inputPassword);
        if (enteredHash !== prompt.session.passwordHash) {
            prompt.errorMsg = 'Mật khẩu không chính xác! Vui lòng thử lại.';
            return;
        }

        const targetSession = prompt.session;
        const action = prompt.action;
        app.sessionState.authPrompt = { show: false, action: '', session: null, inputPassword: '', errorMsg: '' };

        if (action === 'load') {
            this.applySessionData(app, targetSession);
        } else if (action === 'delete') {
            this.deleteSessionById(app, targetSession.id);
        } else if (action === 'import') {
            this.finalizeImportSession(app, targetSession);
        }
    },

    // Nạp dữ liệu suất thi vào giao diện làm việc hiện tại
    applySessionData(app, sessionItem) {
        const d = sessionItem.data;
        if (!d) return;

        // Dừng đồng hồ nếu đang chạy để tránh nhảy giờ đột ngột
        if (app.timer.isRunning) {
            app.toggleTimer();
        }

        if (d.config) Object.assign(app.config, JSON.parse(JSON.stringify(d.config)));
        app.students = Array.isArray(d.students) ? JSON.parse(JSON.stringify(d.students)) : [];
        app.logs = Array.isArray(d.logs) ? JSON.parse(JSON.stringify(d.logs)) : [];
        if (d.picker) Object.assign(app.picker, JSON.parse(JSON.stringify(d.picker)));

        if (d.timer && typeof d.timer.timeLeft === 'number') {
            app.timer.timeLeft = d.timer.timeLeft;
        } else {
            app.timer.timeLeft = (app.config.durationMinutes || 45) * 60;
        }

        app.sessionState.currentSessionId = sessionItem.id;
        app.sessionState.showModal = false;
        app.saveToLocalStorage();

        app.triggerToast(`Đã mở suất thi: ${sessionItem.className} (${sessionItem.examTime})`, 'success');
    },

    deleteSessionById(app, sessionId) {
        const list = this.loadAllSessions().filter(s => s.id !== sessionId);
        this.persistAllSessions(list);
        app.sessionState.savedSessions = list;
        if (app.sessionState.currentSessionId === sessionId) {
            app.sessionState.currentSessionId = null;
        }
        app.triggerToast('Đã xóa suất thi khỏi bộ nhớ trình duyệt.', 'info');
    },

    // Xuất suất thi ra file .JSON để lưu vào thư mục exam trên máy tính
    async exportSessionToJson(app, specificSession = null) {
        let payload = specificSession;
        if (!payload) {
            const rawPass = (app.sessionState.newPassword || '').trim();
            const passHash = rawPass ? await hashPassword(rawPass) : null;
            payload = this.buildSessionPayload(app, null, passHash);
        }

        const jsonStr = JSON.stringify(payload, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);

        const safeClass = sanitizeFilename(payload.className);
        const safeTime = sanitizeFilename(payload.examTime);
        const fileName = `SuatThi_${safeClass}_${safeTime}.json`;

        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        app.triggerToast(`Đã xuất file ${fileName}`, 'success');
    },

    // Nhập suất thi từ file .JSON trong thư mục exam trên máy tính
    importSessionFromJson(app, event) {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const parsed = JSON.parse(e.target.result);
                if (!parsed || !parsed.data || !parsed.data.config) {
                    app.triggerToast('File JSON không đúng định dạng suất thi của hệ thống!', 'error');
                    return;
                }

                if (parsed.hasPassword && parsed.passwordHash) {
                    app.sessionState.authPrompt = {
                        show: true,
                        action: 'import',
                        session: parsed,
                        inputPassword: '',
                        errorMsg: ''
                    };
                } else {
                    this.finalizeImportSession(app, parsed);
                }
            } catch (err) {
                app.triggerToast('Lỗi đọc file JSON! Vui lòng kiểm tra lại file.', 'error');
            } finally {
                event.target.value = '';
            }
        };
        reader.readAsText(file, 'UTF-8');
    },

    finalizeImportSession(app, parsedSession) {
        const list = this.loadAllSessions();
        const importedRecord = {
            ...parsedSession,
            id: parsedSession.id || `SES_${Date.now()}`
        };

        // Lưu hoặc cập nhật vào danh sách trên trình duyệt để lần sau mở nhanh
        const idx = list.findIndex(s => s.id === importedRecord.id);
        if (idx !== -1) {
            list[idx] = importedRecord;
        } else {
            list.unshift(importedRecord);
        }
        this.persistAllSessions(list);
        app.sessionState.savedSessions = list;

        // Nạp thẳng dữ liệu vào phòng thi hiện tại
        this.applySessionData(app, importedRecord);
    }
};
