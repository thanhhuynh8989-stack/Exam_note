export const printModule = {
    // Hàm kích hoạt chế độ xem trước và in ấn chuẩn A4 Dọc (Portrait) theo mẫu ĐH Duy Tân
    printExamSheet(app) {
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            if (typeof app.triggerToast === 'function') {
                app.triggerToast("Trình duyệt đang chặn cửa sổ pop-up. Hãy cho phép để xem trước bản in!", "error");
            } else {
                alert("Trình duyệt đang chặn cửa sổ pop-up. Hãy cho phép để xem trước bản in!");
            }
            return;
        }

        const cfg = app.config || {};
        const students = app.students || [];
        const khoiLop = `${cfg.subjectCode || ''} ${cfg.subClass || ''}`.trim();

        let studentRowsHTML = '';
        if (students.length === 0) {
            studentRowsHTML = `
                <tr>
                    <td colspan="13" style="text-align: center; padding: 15px; color: #666; font-style: italic;">
                        Chưa có dữ liệu sinh viên trong danh sách phòng thi này.
                    </td>
                </tr>
            `;
        } else {
            students.forEach((st, idx) => {
                const isAbsent = st.isPresent === false;
                const noteDisplay = isAbsent ? 'Vắng' : (st.note || '');

                studentRowsHTML += `
                    <tr style="height: 25px;">
                        <td style="text-align: center;">${idx + 1}</td>
                        <td style="font-family: monospace; font-weight: bold; text-align: center;">${st.mssv || ''}</td>
                        <td style="text-align: left; padding-left: 5px;">${st.hoLot || ''}</td>
                        <td style="text-align: left; padding-left: 5px; font-weight: bold;">${st.ten || ''}</td>
                        <td style="text-align: center; font-size: 8.5pt;">${khoiLop}</td>
                        <td style="text-align: center; font-size: 8.5pt;">${st.className || ''}</td>
                        <td style="text-align: center;"></td> <!-- SỐ TỜ -->
                        <td style="text-align: center;"></td> <!-- KÝ TÊN -->
                        <td style="text-align: center;"></td> <!-- Đồ án Cá nhân -->
                        <td style="text-align: center;"></td> <!-- Đồ án nhóm -->
                        <td style="text-align: center;"></td> <!-- Kiểm Tra Cuối Kỳ -->
                        <td style="text-align: center;"></td> <!-- CHỮ -->
                        <td style="text-align: center; font-size: 8.5pt;">${noteDisplay}</td> <!-- GHI CHÚ -->
                    </tr>
                `;
            });
        }

        const htmlContent = `
            <!DOCTYPE html>
            <html lang="vi">
            <head>
                <meta charset="UTF-8">
                <link rel="icon" href="data:;base64,iVBORw0KGgo=">
                <title>DANH SÁCH SINH VIÊN DỰ THI KTHP - ${cfg.subjectName || cfg.subjectCode || 'Môn học'}</title>
                <style>
                    @page {
                        size: A4 portrait;
                        margin: 10mm 8mm;
                    }
                    * {
                        box-sizing: border-box;
                        -webkit-print-color-adjust: exact;
                    }
                    body {
                        font-family: 'Times New Roman', Times, serif;
                        font-size: 10pt;
                        color: #000;
                        line-height: 1.25;
                        margin: 0;
                        padding: 0;
                        background: #525659;
                    }
                    .page-container {
                        width: 210mm;
                        min-height: 297mm;
                        padding: 10mm 10mm;
                        margin: 10mm auto;
                        background: #ffffff;
                        box-shadow: 0 0 15px rgba(0,0,0,0.3);
                        position: relative;
                    }
                    @media print {
                        body { background: none; }
                        .page-container {
                            width: 100%;
                            margin: 0;
                            padding: 0;
                            box-shadow: none;
                        }
                        .no-print { display: none !important; }
                    }
                    .preview-toolbar {
                        position: fixed;
                        top: 0;
                        left: 0;
                        right: 0;
                        background: #0f172a;
                        color: #fff;
                        padding: 10px 24px;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        z-index: 1000;
                        box-shadow: 0 4px 6px -1px rgba(0,0,0,0.2);
                        font-family: Arial, sans-serif;
                    }
                    .preview-toolbar h3 { margin: 0; font-size: 15px; }
                    .btn-action {
                        background: #2563eb;
                        color: white;
                        border: none;
                        padding: 8px 16px;
                        border-radius: 6px;
                        font-weight: bold;
                        cursor: pointer;
                        font-size: 13px;
                        margin-left: 8px;
                    }
                    .btn-action:hover { background: #1d4ed8; }
                    .btn-close { background: #64748b; }
                    .btn-close:hover { background: #475569; }
                    .preview-spacer { height: 48px; }

                    /* HEADER CONTAINER CHUẨN CÂN ĐỐI 3 CỘT */
                    .header-table {
                        width: 100%;
                        border-collapse: collapse;
                        margin-bottom: 8px;
                        table-layout: fixed;
                    }
                    .header-table td {
                        padding: 2px 0;
                        vertical-align: middle;
                    }
                    .col-left { text-align: center; white-space: nowrap; }
                    .col-center { text-align: center; white-space: nowrap; }
                    .col-right { text-align: right; white-space: nowrap; }
                    
                    .bold { font-weight: bold; }
                    .uppercase { text-transform: uppercase; }

                    .student-table {
                        width: 100%;
                        border-collapse: collapse;
                        margin-top: 6px;
                        margin-bottom: 8px;
                        table-layout: fixed;
                    }
                    .student-table th, .student-table td {
                        border: 1px solid #000;
                        padding: 3px 2px;
                        font-size: 8.5pt;
                        overflow: hidden;
                        word-wrap: break-word;
                    }
                    .student-table th {
                        background-color: #ffffff;
                        text-align: center;
                        font-weight: bold;
                    }

                    .footer-summary {
                        font-size: 9.5pt;
                        font-style: italic;
                        margin-top: 8px;
                        margin-bottom: 15px;
                    }
                    .signature-table {
                        width: 100%;
                        border-collapse: collapse;
                        text-align: center;
                        font-weight: bold;
                        font-size: 10pt;
                    }
                    .signature-table td {
                        width: 33.33%;
                        vertical-align: top;
                        padding: 2px;
                    }
                    .sig-space {
                        height: 55px;
                    }
                </style>
            </head>
            <body>

                <div class="preview-toolbar no-print">
                    <h3>📄 Xem Trước Bản In A4 (Khổ Dọc - Chuẩn ĐH Duy Tân)</h3>
                    <div>
                        <button class="btn-action" onclick="window.print()">🖨️ In / Xuất PDF</button>
                        <button class="btn-action btn-close" onclick="window.close()">Đóng</button>
                    </div>
                </div>
                <div class="preview-spacer no-print"></div>

                <div class="page-container">
                    
                    <!-- HEADER 4 DÒNG CÂN ĐỐI CHUẨN ĐẠI HỌC DUY TÂN -->
                    <table class="header-table">
                        <colgroup>
                            <col style="width: 36%;">
                            <col style="width: 48%;">
                            <col style="width: 16%;">
                        </colgroup>
                        <tr>
                            <td class="col-left">BỘ GIÁO DỤC & ĐÀO TẠO</td>
                            <td class="col-center bold uppercase" style="font-size: 11pt;">
                                DANH SÁCH SINH VIÊN DỰ THI KTHP * NH: ${cfg.academicYear || '2026-2027'}
                            </td>
                            <td class="col-right bold">Số TC : ${cfg.credits || '1'}</td>
                        </tr>
                        <tr>
                            <td class="col-left bold uppercase">ĐẠI HỌC DUY TÂN</td>
                            <td class="col-center bold" style="font-size: 11pt;">
                                KHỐI LỚP: &nbsp;&nbsp;&nbsp;&nbsp; ${khoiLop}
                            </td>
                            <td class="col-right bold">Học kỳ : ${cfg.semester || '1'}</td>
                        </tr>
                        <tr>
                            <!-- Gộp 2 ô đầu dòng 3 (Colspan 2) và căn giữa MÔN & MÃ MÔN -->
                            <td colspan="2" class="col-center bold" style="text-align: center; white-space: normal; word-break: break-word;">
                                MÔN : <span style="font-weight: normal;">${cfg.subjectName || ''}</span>
                                &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
                                MÃ MÔN : ${cfg.subjectCode || ''}
                            </td>
                            <td class="col-right bold">Lần thi : ${cfg.examAttempt || '1'}</td>
                        </tr>
                        <tr>
                            <td colspan="3" style="padding-top: 4px; text-align: left; white-space: normal;">
                                <i>Thời gian:</i> &nbsp;&nbsp; <b>${cfg.examTime || ''}</b> &nbsp;&nbsp;&nbsp;&nbsp;
                                - <i>Phòng:</i> &nbsp;&nbsp; <b>${cfg.roomName || ''}</b> &nbsp;&nbsp;&nbsp;&nbsp;
                                - <i>Cơ sở:</i> &nbsp;&nbsp; <b>${cfg.facility || ''}</b>
                            </td>
                        </tr>
                    </table>

                    <!-- BẢNG DANH SÁCH THÍ SINH (13 CỘT CÂN ĐỐI A4 DỌC) -->
                    <table class="student-table">
                        <thead>
                            <tr>
                                <th rowspan="2" style="width: 25px;">STT</th>
                                <th rowspan="2" style="width: 80px;">MSV</th>
                                <th rowspan="2" style="width: 115px;">HỌ VÀ</th>
                                <th rowspan="2" style="width: 50px;">TÊN</th>
                                <th rowspan="2" style="width: 70px;">LỚP MÔN HỌC</th>
                                <th rowspan="2" style="width: 60px;">LỚP SINH HOẠT</th>
                                <th rowspan="2" style="width: 30px;">SỐ TỜ</th>
                                <th rowspan="2" style="width: 55px;">KÝ TÊN</th>
                                <th colspan="4">ĐIỂM THI KTHP</th>
                                <th rowspan="2" style="width: 55px;">GHI CHÚ</th>
                            </tr>
                            <tr>
                                <th style="width: 32px; font-size: 7.5pt;">Đồ án Cá nhân</th>
                                <th style="width: 32px; font-size: 7.5pt;">Đồ án nhóm</th>
                                <th style="width: 38px; font-size: 7.5pt;">Kiểm Tra Cuối Kỳ</th>
                                <th style="width: 34px; font-size: 7.5pt;">CHỮ</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${studentRowsHTML}
                        </tbody>
                    </table>

                    <!-- CHÂN TRANG & KHU VỰC CHỮ KÝ 3 BÊN -->
                    <div class="footer-summary">
                        Số SV vắng: ....... &nbsp;&nbsp;&nbsp;&nbsp; Đình chỉ: ........ &nbsp;&nbsp;&nbsp;&nbsp; Tổng số bài: ........ &nbsp;&nbsp;&nbsp;&nbsp; Tổng số tờ: ........
                    </div>

                    <table class="signature-table">
                        <tr>
                            <td>GIÁM KHẢO 1</td>
                            <td>GIÁM KHẢO 2</td>
                            <td>TRUNG TÂM KHẢO THÍ</td>
                        </tr>
                        <tr>
                            <td class="sig-space"></td>
                            <td class="sig-space"></td>
                            <td class="sig-space"></td>
                        </tr>
                        <tr>
                            <td class="uppercase">${cfg.examiner1 || ''}</td>
                            <td class="uppercase">${cfg.examiner2 || ''}</td>
                            <td></td>
                        </tr>
                    </table>

                </div>

            </body>
            </html>
        `;

        printWindow.document.write(htmlContent);
        printWindow.document.close();
    }
};
