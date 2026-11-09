export const timerModule = {
    toggleTimer(app) {
        if (app.timer.isRunning) {
            clearInterval(app.timer.intervalId);
            app.timer.isRunning = false;
        } else {
            if (!app.timer.timeLeft || app.timer.timeLeft <= 0) {
                app.timer.timeLeft = (app.config.durationMinutes || 45) * 60;
            }
            app.timer.isRunning = true;
            app.timer.intervalId = setInterval(() => {
                if (app.timer.timeLeft > 0) {
                    app.timer.timeLeft--;
                } else {
                    clearInterval(app.timer.intervalId);
                    app.timer.isRunning = false;
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
        app.triggerToast("Đã đặt lại đồng hồ đếm ngược!", "info");
    },

    // Tăng/giảm Giờ
    adjustHours(app, amount) {
        app.timer.timeLeft = Math.max(0, app.timer.timeLeft + amount * 3600);
        app.config.durationMinutes = Math.ceil(app.timer.timeLeft / 60);
        app.saveToLocalStorage();
        const label = amount > 0 ? `+${amount} giờ` : `${amount} giờ`;
        app.triggerToast(`Đã điều chỉnh: ${label}`, "info");
    },

    // Tăng/giảm Phút
    adjustMinutes(app, amount) {
        app.timer.timeLeft = Math.max(0, app.timer.timeLeft + amount * 60);
        app.config.durationMinutes = Math.ceil(app.timer.timeLeft / 60);
        app.saveToLocalStorage();
        const label = amount > 0 ? `+${amount} phút` : `${amount} phút`;
        app.triggerToast(`Đã điều chỉnh: ${label}`, "info");
    },

    addExtraMinutes(app, mins) {
        app.timer.timeLeft = Math.max(0, app.timer.timeLeft + mins * 60);
        app.config.durationMinutes = Math.ceil(app.timer.timeLeft / 60);
        app.saveToLocalStorage();
        const actionText = mins > 0 ? `Thêm ${mins} phút` : `Giảm ${Math.abs(mins)} phút`;
        app.triggerToast(`Đã ${actionText} thời gian làm bài!`, "info");
    },

    setQuickDuration(app, mins) {
        app.config.durationMinutes = mins;
        if (app.timer.intervalId) {
            clearInterval(app.timer.intervalId);
        }
        app.timer.isRunning = false;
        app.timer.timeLeft = mins * 60;
        app.saveToLocalStorage();
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
        const timeStr = new Date().toLocaleTimeString('vi-VN');
        app.logs.unshift({
            time: timeStr,
            text: app.newLogText.trim()
        });
        app.newLogText = '';
        app.saveToLocalStorage();
    }
};
