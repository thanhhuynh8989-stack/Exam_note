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

    // Xử lý tăng (+) hoặc giảm (-) phút ngắt giờ làm bài
    addExtraMinutes(app, mins) {
        app.timer.timeLeft = Math.max(0, app.timer.timeLeft + mins * 60);
        const actionText = mins > 0 ? `Thêm ${mins} phút` : `Giảm ${Math.abs(mins)} phút`;
        app.triggerToast(`Đã ${actionText} thời gian làm bài!`, "info");
    },

    // Đặt nhanh thời gian làm bài thi (15, 30, 45, 60, 90 phút...)
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
        const m = Math.floor(s / 60);
        const remainingSecs = s % 60;
        const pad = (n) => String(n).padStart(2, '0');
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
