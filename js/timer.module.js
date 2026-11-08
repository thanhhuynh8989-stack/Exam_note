export const timerModule = {
    toggleTimer(app) {
        if (app.timer.isRunning) {
            clearInterval(app.timer.intervalId);
            app.timer.isRunning = false;
            app.triggerToast("Đã tạm dừng đồng hồ!", "warning");
        } else {
            app.timer.isRunning = true;
            app.triggerToast("Bắt đầu tính giờ làm bài!", "success");
            app.timer.intervalId = setInterval(() => {
                if (app.timer.timeLeft > 0) app.timer.timeLeft--;
                else { 
                    clearInterval(app.timer.intervalId); 
                    app.timer.isRunning = false; 
                    app.triggerToast("HẾT GIỜ LÀM BÀI!", "error"); 
                }
            }, 1000);
        }
    },
    resetTimer(app) {
        clearInterval(app.timer.intervalId);
        app.timer.isRunning = false;
        app.timer.timeLeft = (app.config.durationMinutes || 45) * 60;
        app.triggerToast("Đã đặt lại đồng hồ thi!", "info");
    },
    addExtraMinutes(app, mins) {
        app.timer.timeLeft += mins * 60;
        app.triggerToast(`Đã cộng thêm ${mins} phút!`, "success");
    },
    formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    },
    addLog(app) {
        if (!app.newLogText.trim()) return;
        app.logs.unshift({ time: new Date().toLocaleTimeString('vi-VN'), text: app.newLogText.trim() });
        app.newLogText = '';
        app.saveToLocalStorage();
    }
};