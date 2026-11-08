export const configModule = {
    getTotalPoints(app) {
        return app.config.sections.reduce((sum, sec) => sum + (Number(sec.maxScore) || 0), 0);
    },
    addSection(app) {
        app.config.sections.push({ title: 'Phần mới', maxScore: 2, note: '' });
        app.saveToLocalStorage();
    },
    removeSection(app, idx) {
        app.config.sections.splice(idx, 1);
        app.saveToLocalStorage();
    }
};