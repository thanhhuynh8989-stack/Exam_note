export const pickerModule = {
    getExamListArray(app) {
        return app.picker.rawExamList.split('\n').map(i => i.trim()).filter(i => i.length > 0);
    },
    startRandomDraw(app) {
        const available = this.getExamListArray(app);
        if (available.length === 0) { app.triggerToast("Hết đề thi!", "warning"); return; }
        app.picker.isSpinning = true;
        let count = 0;
        const timer = setInterval(() => {
            app.picker.currentDisplay = available[Math.floor(Math.random() * available.length)];
            count += 70;
            if (count >= 1500) {
                clearInterval(timer);
                app.picker.isSpinning = false;
                const drawn = app.picker.currentDisplay;
                if (app.picker.targetStudentId) {
                    const st = app.students.find(s => s.id === app.picker.targetStudentId);
                    if (st) st.assignedExam = drawn;
                }
                app.triggerToast(`Đã bốc đề: ${drawn}`, "success");
                app.saveToLocalStorage();
            }
        }, 70);
    }
};