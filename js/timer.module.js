export const timerModule = {
    toggleTimer(app, silent = false) {
        if (app.timer.isRunning) {
            clearInterval(app.timer.intervalId);
            app.timer.isRunning = false;
            app.timer.updatedAt = Date.now();
            if (!silent && app.recordAuditLog) {
                app.recordAuditLog(`Tạm dừng đồng hồ làm bài (Còn lại: ${this.formatTime(app.timer.timeLeft)})`);
            }
        } else {
            if (!app.timer.timeLeft || app.timer.timeLeft <= 0) {
                app.timer.timeLeft = (app.config.durationMinutes || 45) * 60;
            }
            app.timer.isRunning = true;
            app.timer.updatedAt = Date.now();
            if (!silent && app.recordAuditLog) {
                app.recordAuditLog(`Bắt đầu tính giờ làm bài (${this.formatTime(app.timer.timeLeft)})`);
            }
            app.timer.intervalId = setInterval(() => {
                if (app.timer.timeLeft > 0) {
                    app.timer.timeLeft--;
                } else {
                    clearInterval(app.timer.intervalId);
                    app.timer.isRunning = false;
                    app.timer.updatedAt = Date.now();
                    if (app.recordAuditLog) {
                        app.recordAuditLog("Hết giờ làm bài theo quy định");
                    }
                    app.triggerToast("Đã hết giờ làm bài!", "warning");
                }
            }, 1000);
        }
    },

    resetTimer(app) {
        if (app.timer.intervalId) {
            clearInterval(app.timer.intervalId);
        }
        app.timer.isRunning = false;
        app.timer.timeLeft = (app.config.durationMinutes || 45) * 60;
        app.timer.updatedAt = Date.now();
        if (app.recordAuditLog) {
            app.recordAuditLog(`Đặt lại đồng hồ về ${this.formatTime(app.timer.timeLeft)}`);
        }
        app.triggerToast("Đã đặt lại đồng hồ đếm ngược!", "info");
    },

    adjustHours(app, amount) {
        app.timer.timeLeft = Math.max(0, app.timer.timeLeft + amount * 3600);
        app.timer.updatedAt = Date.now();
        const label = amount > 0 ? `+${amount} giờ` : `${amount} giờ`;
        if (app.recordAuditLog) {
            app.recordAuditLog(`Điều chỉnh đồng hồ (${label}) → Còn ${this.formatTime(app.timer.timeLeft)}`);
        } else {
            app.saveToLocalStorage();
        }
        app.triggerToast(`Đã điều chỉnh: ${label}`, "info");
    },

    adjustMinutes(app, amount) {
        app.timer.timeLeft = Math.max(0, app.timer.timeLeft + amount * 60);
        app.timer.updatedAt = Date.now();
        const label = amount > 0 ? `+${amount} phút` : `${amount} phút`;
        if (app.recordAuditLog) {
            app.recordAuditLog(`Điều chỉnh đồng hồ (${label}) → Còn ${this.formatTime(app.timer.timeLeft)}`);
        } else {
            app.saveToLocalStorage();
        }
        app.triggerToast(`Đã điều chỉnh: ${label}`, "info");
    },

    addExtraMinutes(app, mins) {
        app.timer.timeLeft = Math.max(0, app.timer.timeLeft + mins * 60);
        app.timer.updatedAt = Date.now();
        const actionText = mins > 0 ? `Bù thêm ${mins} phút` : `Giảm ${Math.abs(mins)} phút`;
        if (app.recordAuditLog) {
            app.recordAuditLog(`${actionText} làm bài → Còn ${this.formatTime(app.timer.timeLeft)}`);
        } else {
            app.saveToLocalStorage();
        }
        app.triggerToast(`Đã ${actionText.toLowerCase()} thời gian làm bài!`, "info");
    },

    setQuickDuration(app, mins) {
        app.config.durationMinutes = mins;
        if (app.timer.intervalId) {
            clearInterval(app.timer.intervalId);
        }
        app.timer.isRunning = false;
        app.timer.timeLeft = mins * 60;
        app.timer.updatedAt = Date.now();
        if (app.recordAuditLog) {
            app.recordAuditLog(`Thiết lập thời lượng làm bài: ${mins} phút`);
        } else {
            app.saveToLocalStorage();
        }
        app.triggerToast(`Đã thiết lập thời gian làm bài: ${mins} phút!`, "success");
    },

    formatTime(seconds) {
        const s = Math.max(0, seconds || 0);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const remainingSecs = s % 60;
        const pad = (n) => String(n).padStart(2, '0');
        
        if (h > 0) {
            return `${pad(h)}:${pad(m)}:${pad(remainingSecs)}`;
        }
        return `${pad(m)}:${pad(remainingSecs)}`;
    },

    addLog(app) {
        if (!app.newLogText || !app.newLogText.trim()) return;
        const text = app.newLogText.trim();
        app.newLogText = '';
        if (app.recordAuditLog) {
            app.recordAuditLog(text);
        } else {
            app.logs.unshift({
                time: new Date().toLocaleTimeString('vi-VN'),
                text
            });
            app.saveToLocalStorage();
        }
    }
};
