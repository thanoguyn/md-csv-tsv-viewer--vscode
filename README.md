# MD/CSV/TSV Viewer for VS Code

Extension VS Code giúp mở file Markdown, CSV và TSV ở chế độ viewer mặc định. Khi cần chỉnh sửa, bạn có thể chuyển nhanh sang text editor của VS Code và quay lại viewer bằng nút hoặc phím tắt.

## File Được Hỗ Trợ

- Markdown: `.md`, `.markdown`, `.mdown`, `.mkd`
- Bảng dữ liệu: `.csv`, `.tsv`

Các định dạng trên được cấu hình mở bằng `MD Viewer` mặc định thông qua `workbench.editorAssociations`.

## Cài Đặt Từ VSIX

1. Mở VS Code.
2. Chạy lệnh `Extensions: Install from VSIX...`.
3. Chọn file `mdviewer-vscode-0.1.3.vsix`.
4. Reload VS Code nếu được yêu cầu.

Sau khi cài đặt, click file được hỗ trợ hoặc mở bằng Quick Open đều sẽ vào viewer mặc định.

## Chế Độ Viewer Và Edit

- Trong viewer, nhấn `E` hoặc nút `Edit` để mở file bằng text editor của VS Code.
- Trong text editor, nhấn `Cmd+Alt+V` trên macOS hoặc `Ctrl+Alt+V` trên Windows/Linux để quay lại viewer.
- Có thể dùng nút `Open in MD Viewer` trên editor title để mở lại viewer.

## Tính Năng Chung

- Viewer mặc định cho Markdown, CSV và TSV.
- Chuyển full width bằng nút `Full width` hoặc phím `F`.
- Chuyển theme sáng/tối bằng nút `Theme`.
- Tìm kiếm giống trình duyệt bằng `Cmd+F` hoặc `Ctrl+F`.
- Copy nội dung đang xem bằng `C`.
- Copy source bằng `Shift+C`.
- Chọn toàn bộ nội dung viewer hoặc bảng bằng `Cmd+A` hoặc `Ctrl+A`.
- Lưu bản copy source bằng nút `Save copy` hoặc phím `D`.
- Export PDF bằng nút `PDF` hoặc phím `P`.
- Ẩn/hiện toolbar bằng `Ctrl+B`.
- Toast thông báo khi copy, lưu hoặc thao tác thành công/thất bại.

## Markdown Viewer

- Render Markdown với heading, list, quote, link, image, table và code block.
- Hỗ trợ Mermaid diagram.
- Hỗ trợ table tương tác trong Markdown.
- Hỗ trợ TOC cố định bên phải nội dung khi đủ không gian.
- TOC có thể bật/tắt bằng nút `TOC` hoặc phím `T`.
- TOC tự cập nhật theo vị trí scroll và tự mở heading con, tối đa 3 cấp.
- Hỗ trợ source view bằng nút `Source` hoặc phím `S`.
- Hover vào heading để hiện icon copy và icon select.
- Click icon copy trên heading để copy toàn bộ nội dung Markdown thuộc section đó.
- `Shift+Click` icon copy trên heading để append vào nội dung copy trước đó.
- Click icon select trên heading để bôi đen toàn bộ nội dung con của heading.
- Code block có nút copy, hỗ trợ `Shift+Click` để append.
- Table trong Markdown có copy toàn bảng, copy body, export CSV/TSV và mở dạng grid.

## CSV/TSV Viewer

- File CSV và TSV mở bằng grid tương tác.
- Tự parse dữ liệu thành bảng.
- Bật/tắt wrap bằng `W`.
- Bật/tắt dòng đầu là header bằng `H`.
- Chuyển định dạng parse số `Auto`, `VN`, `US` bằng `U`.
- Sort theo cột.
- Bật filter row và lọc từng cột.
- Chọn ô, dòng, cột hoặc vùng dữ liệu.
- `Shift` khi chọn dòng để mở rộng vùng chọn.
- Copy selection, copy toàn bảng hoặc copy body.
- `Shift+Click` khi copy để append vào nội dung copy trước đó.
- Context menu trên grid có copy thường và copy số theo định dạng US.
- Export bảng ra CSV hoặc TSV.

## Tìm Kiếm

- `Cmd+F` trên macOS hoặc `Ctrl+F` trên Windows/Linux để mở thanh tìm kiếm.
- Gõ từ khóa để highlight tất cả kết quả trong viewer hiện tại.
- `Enter` chuyển tới kết quả tiếp theo.
- `Shift+Enter` quay lại kết quả trước.
- `Escape` đóng thanh tìm kiếm.
- Tìm kiếm hoạt động với Markdown preview, Markdown source view và CSV/TSV grid.

## Export PDF

- Nhấn nút `PDF` hoặc phím `P`.
- PDF được tạo từ DOM preview hiện tại bằng `html2canvas` và `jsPDF`.
- Markdown preview, Markdown source view và CSV/TSV grid đều được export theo layout đang xem.
- Các control như toolbar, TOC, nút copy, filter row và highlight tìm kiếm sẽ không xuất hiện trong PDF.

## Phím Tắt

| Phím | Chức năng |
| --- | --- |
| `E` | Mở file hiện tại bằng text editor |
| `Cmd+Alt+V` | macOS: mở lại viewer từ text editor |
| `Ctrl+Alt+V` | Windows/Linux: mở lại viewer từ text editor |
| `Cmd+F` / `Ctrl+F` | Mở thanh tìm kiếm |
| `Enter` trong find | Kết quả tìm kiếm tiếp theo |
| `Shift+Enter` trong find | Kết quả tìm kiếm trước đó |
| `Escape` | Đóng find/help/context menu khi đang mở |
| `Cmd+A` / `Ctrl+A` | Chọn toàn bộ nội dung viewer hoặc grid |
| `Ctrl+B` | Ẩn/hiện toolbar |
| `F` | Bật/tắt full width |
| `T` | Bật/tắt TOC trong Markdown preview |
| `S` | Bật/tắt source view trong Markdown |
| `W` | Bật/tắt wrap cho code, table hoặc grid |
| `U` | Chuyển định dạng parse số `Auto`/`VN`/`US` |
| `H` | Bật/tắt dòng đầu là header trong CSV/TSV |
| `D` | Save copy source file |
| `P` | Export PDF |
| `C` | Copy nội dung đang xem |
| `Shift+C` | Copy source |
| `Shift+Click` copy button | Append vào nội dung copy trước đó |

## Lệnh VS Code

| Command | Mô tả |
| --- | --- |
| `MD Viewer: Open in MD Viewer` | Mở file hiện tại bằng viewer |
| `MD Viewer: Open as Text` | Mở file hiện tại bằng text editor |

## Phát Triển

Cài dependency:

```sh
npm install
```

Chạy kiểm tra syntax:

```sh
npm run lint
```

Build VSIX:

```sh
npx --yes @vscode/vsce package
```

Debug extension:

1. Mở folder này trong VS Code.
2. Nhấn `F5`.
3. VS Code Extension Development Host sẽ mở ra để test extension.

## License

MIT. Xem file `LICENSE`.
