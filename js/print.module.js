export const printModule = {
    // Hàm kích hoạt chế độ xem trước và in ấn chuẩn A4 Dọc (Portrait) theo mẫu ĐH Duy Tân
    printExamSheet(app) {
        // Tạo cửa sổ/tab mới làm giao diện Preview A4
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            if (typeof app.triggerToast === 'function') {
                app.triggerToast("Trình duyệt đang chặn cửa sổ pop-up. Hãy cho phép để xem trước bản in!", "error");
            } else {
                alert("Trình duyệt đang chặn cửa sổ pop-up. Hãy cho phép để xem trước bản in!");
            }
            return;
        }

        // Lấy dữ liệu cấu hình & danh sách sinh viên
        const cfg = app.config || {};
        const students = app.students || [];

        // Tự động ghép Khối lớp từ Mã môn và Lớp HP (VD: BIO101 C1)
        const khoiLop = `${cfg.subjectCode || ''} ${cfg.subClass || ''}`.trim();

        // Render danh sách sinh viên ra các dòng của bảng (13 cột chuẩn theo ảnh)
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
                const scoreDisplay = (!isAbsent && st.totalScore !== undefined && st.totalScore > 0) ? st.totalScore : '';
                const noteDisplay = isAbsent ? 'Vắng' : (st.note || '');

                studentRowsHTML += `
                    <tr style="height: 24px;">
                        <td style="text-align: center;">${idx + 1}</td>
                        <td style="font-family: monospace; font-weight: bold; text-align: center;">${st.mssv || ''}</td>
                        <td style="text-align: left; padding-left: 4px;">${st.hoLot || ''}</td>
                        <td style="text-align: left; padding-left: 4px; font-weight: bold;">${st.ten || ''}</td>
                        <td style="text-align: center; font-size: 8.5pt;">${khoiLop}</td>
                        <td style="text-align: center; font-size: 8.5pt;">${st.className || ''}</td>
                        <td style="text-align: center;"></td> <!-- SỐ TỜ -->
                        <td style="text-align: center;"></td> <!-- KÝ TÊN -->
                        <td style="text-align: center;"></td> <!-- Đồ án Cá nhân -->
                        <td style="text-align: center;"></td> <!-- Đồ án nhóm -->
                        <td style="text-align: center; font-weight: bold;">${scoreDisplay}</td> <!-- Kiểm Tra Cuối Kỳ -->
                        <td style="text-align: center;"></td> <!-- CHỮ -->
                        <td style="text-align: center; font-size: 8.5pt;">${noteDisplay}</td> <!-- GHI CHÚ -->
                    </tr>
                `;
            });
        }

        // Xây dựng mã HTML chuẩn A4 Portrait (Khổ dọc)
        const htmlContent = `
            <!DOCTYPE html>
            <html lang="vi">
            <head>
                <meta charset="UTF-8">
                <title>DANH SÁCH SINH VIÊN DỰ THI KTHP - ${cfg.subjectName || cfg.subjectCode || 'Môn học'}</title>
                <style>
                    /* Định dạng khổ giấy A4 Dọc (Portrait) khi in */
                    @page {
                        size: A4 portrait;
                        margin: 8mm 6mm;
                    }
                    * {
                        box-sizing: border-box;
                        -webkit-print-color-adjust: exact;
                    }
                    body {
                        font-family: 'Times New Roman', Times, serif;
                        font-size: 10pt;
                        color: #000;
                        line-height: 1.2;
                        margin: 0;
                        padding: 0;
                        background: #525659;
                    }

                    /* Khung trang giấy A4 Dọc trên màn hình Preview */
                    .page-container {
                        width: 210mm;
                        min-height: 297mm;
                        padding: 10mm 8mm;
                        margin: 10mm auto;
                        background: #ffffff;
                        box-shadow: 0 0 15px rgba(0,0,0,0.3);
                        position: relative;
                    }

                    /* Khi bấm lệnh in */
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

                    /* Thanh công cụ xem trước */
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

                    /* Header 4 dòng chuẩn Duy Tân */
                    .header-table {
                        width: 100%;
                        border-collapse: collapse;
                        margin-bottom: 6px;
                    }
                    .header-table td {
                        padding: 1.5px 0;
                        vertical-align: middle;
                    }
                    .txt-center { text-align: center; }
                    .txt-right { text-align: right; }
                    .bold { font-weight: bold; }
                    .uppercase { text-transform: uppercase; }

                    /* Bảng danh sách thí sinh 13 cột chuẩn khổ dọc */
                    .student-table {
                        width: 100%;
                        border-collapse: collapse;
                        margin-top: 4px;
                        margin-bottom: 8px;
                    }
                    .student-table th, .student-table td {
                        border: 1px solid #000;
                        padding: 3px 1px;
                        font-size: 8.5pt;
                    }
                    .student-table th {
                        background-color: #ffffff;
                        text-align: center;
                        font-weight: bold;
                    }

                    /* Chân trang và chữ ký */
                    .footer-summary {
                        font-size: 9.5pt;
                        font-style: italic;
                        margin-top: 6px;
                        margin-bottom: 12px;
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
                        height: 50px;
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
                    
                    <!-- HEADER 4 DÒNG CHUẨN ĐẠI HỌC DUY TÂN -->
                    <table class="header-table">
                        <tr>
                            <td style="width: 32%;" class="txt-center">BỘ GIÁO DỤC & ĐÀO TẠO</td>
                            <td style="width: 50%; font-size: 11pt;" class="txt-center bold uppercase">
                                DANH SÁCH SINH VIÊN DỰ THI KTHP * NH: ${cfg.academicYear || '2026-2027'}
                            </td>
                            <td style="width: 18%;" class="txt-right bold">Số TC : ${cfg.credits || '1'}</td>
                        </tr>
                        <tr>
                            <td class="txt-center bold uppercase">ĐẠI HỌC DUY TÂN</td>
                            <td class="txt-center bold" style="font-size: 10.5pt;">
                                KHỐI LỚP: &nbsp;&nbsp;&nbsp;&nbsp; ${khoiLop}
                            </td>
                            <td class="txt-right bold">Học kỳ : ${cfg.semester || '1'}</td>
                        </tr>
                        <tr>
                            <td class="bold">MÔN : <span style="font-weight: normal;">${cfg.subjectName || ''}</span></td>
                            <td class="txt-center bold">MÃ MÔN : ${cfg.subjectCode || ''}</td>
                            <td class="txt-right bold">Lần thi : ${cfg.examAttempt || '1'}</td>
                        </tr>
                        <tr>
                            <td colspan="3" style="padding-top: 3px;">
                                <i>Thời gian:</i> &nbsp;&nbsp; <b>${cfg.examTime || ''}</b> &nbsp;&nbsp;&nbsp;&nbsp;
                                - <i>Phòng:</i> &nbsp;&nbsp; <b>${cfg.roomName || ''}</b> &nbsp;&nbsp;&nbsp;&nbsp;
                                - <i>Cơ sở:</i> <b>${cfg.facility || ''}</b>
                            </td>
                        </tr>
                    </table>

                    <!-- BẢNG DANH SÁCH 13 CỘT (CĂN CHỈNH TỶ LỆ DỌC A4) -->
                    <table class="student-table">
                        <thead>
                            <tr>
                                <th rowspan="2" style="width: 24px;">STT</th>
                                <th rowspan="2" style="width: 78px;">MSV</th>
                                <th rowspan="2" style="width: 110px;">HỌ VÀ</th>
                                <th rowspan="2" style="width: 50px;">TÊN</th>
                                <th rowspan="2" style="width: 65px;">LỚP MÔN HỌC</th>
                                <th rowspan="2" style="width: 60px;">LỚP SINH HOẠT</th>
                                <th rowspan="2" style="width: 28px;">SỐ TỜ</th>
                                <th rowspan="2" style="width: 50px;">KÝ TÊN</th>
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

        // Nạp HTML vào cửa sổ mới
        printWindow.document.write(htmlContent);
        printWindow.document.close();
    }
};
