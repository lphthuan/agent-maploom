# AgentMaploom

**Setup dự án, bản đồ mã nguồn và ngữ cảnh trên máy cho AI coding Agent.**

[English](README.md) · [Hướng dẫn bắt đầu](docs/GETTING_STARTED.md) · [Cấu hình](docs/CONFIGURATION.md) · [Tải release](https://github.com/lphthuan/agent-maploom/releases)

AgentMaploom chuẩn bị dự án để Agent bắt đầu từ một `AGENTS.md` ngắn, tìm mã nguồn và quyết định cũ, kiểm thử và lưu tiến trình cho phiên sau. Ưu tiên Unity C#; hỗ trợ TypeScript/JavaScript để phát triển chính toolkit.

Dùng từ Codex, VS Code, Antigravity hoặc app/CLI có thể đọc file và chạy lệnh. Agent/model bạn chọn thực hiện việc lập trình. Nếu app không tự đọc `AGENTS.md`, yêu cầu đọc file này đầu phiên.

> **v0.2.0 là bản phát hành ban đầu.** Setup đã kiểm tra trên Windows; CLI macOS/Linux còn thử nghiệm. Bạn tự chỉnh scene, prefab, cấu hình Unity và build mobile.

## Cài trên Windows

Tải và giải nén `agent-maploom-v0.2.0-windows-source.zip` ở [release v0.2.0](https://github.com/lphthuan/agent-maploom/releases/tag/v0.2.0). Hoặc clone:

```powershell
git clone https://github.com/lphthuan/agent-maploom.git
cd agent-maploom
powershell -NoProfile -ExecutionPolicy Bypass -File .\bootstrap.ps1 -Project 'D:\Games\MyUnityGame'
```

Đổi đường dẫn thành **dự án của bạn**. `ExecutionPolicy Bypass` áp dụng cho process này, không đổi policy toàn máy. Giữ thư mục toolkit vì wrapper dẫn tới đó; khi di chuyển/nâng cấp toolkit, chạy lại setup để cập nhật đường dẫn.

Lần đầu cần mạng. Bootstrap tìm Node.js 24+ hoặc tải runtime Windows có kiểm tra checksum, cài pnpm/dependency đã ghim, cài helper và tạo map. Những lần sau tái sử dụng tool đúng phiên bản. Scan cấu trúc không gọi model, không cần API key.

## Setup cài và tạo gì?

| Thành phần | Tác dụng |
| --- | --- |
| Node.js 24+, pnpm 11.19.0 | Runtime và cài dependency |
| Parser C#/TS/JS | Symbol, vị trí và phụ thuộc đã khai báo |
| Graft 0.21.1 | Graph cấu trúc bổ sung, không gọi LLM |
| Memory MCP 2026.8.31 | Knowledge graph trên máy, đăng ký vào app nếu cần |
| Lavish 0.1.83 | Xem HTML và gửi phản hồi trên máy |
| No-mistakes 1.84.0 | Gate kiểm chứng chỉ chạy trong `full` |
| `AGENTS.md` ở root | Map ngắn dẫn Agent tới tài liệu và lệnh |
| `.agentkit/` | Map, index, cấu hình, bộ nhớ, tiến trình, log và bằng chứng |
| VS Code tasks | Status/map/basic/full/review |

AXI áp dụng trong thiết kế CLI: kết quả gọn, có giới hạn và help theo nhu cầu; không phải package riêng cần cài.

AGENTS cũ được giữ trong `Docs/Agent/PROJECT_RULES.md`. Tasks cũ được giữ; JSONC không bị ghi đè. Có `AGENTS.override.md` thì attachment bị chặn để bạn xử lý quy tắc trước.

**Bạn vẫn cần chuẩn bị** Unity Editor/license, module Android/iOS và SDK, coding agent và tài khoản/API của agent. Unity MCP và Test Framework cần cài/cấu hình trong game để dùng runner tương ứng. Setup báo phần thiếu, không tự sửa package, scene hoặc prefab để cài chúng.

## Làm việc mỗi phiên

Mở thư mục **dự án game**, yêu cầu Agent:

> Đọc AGENTS.md. Ghi yêu cầu bằng task, tìm ngữ cảnh bằng context, kiểm tra mã và phụ thuộc rồi sửa C#. Kiểm thử basic và checkpoint. Tôi tự chỉnh scene, prefab và cấu hình Unity.

Chạy từ root dự án sau setup:

```powershell
node .agentkit/agentkit.mjs task --task cooldown --goal 'Thêm cooldown sát thương tiếp xúc'
node .agentkit/agentkit.mjs context 'contact damage cooldown'
# Agent kiểm tra source và thực hiện thay đổi tại đây.
node .agentkit/agentkit.mjs verify --mode basic --test Game.Tests.DamageTests
node .agentkit/agentkit.mjs checkpoint --task current --done 'Đã thêm cooldown' --next 'Thử gameplay trong Editor'
node .agentkit/agentkit.mjs handoff --task current
```

Đổi tên test thành test có thật. Với Node, dùng đường dẫn test hoặc `--changed src/file.ts`. Phiên sau chạy `resume --task current`. Ghi bài học có nguồn bằng `memory add "bài học" --source docs/decision.md`.

`context` mặc định tối đa 8 file/10.000 ký tự, đưa ra vị trí ứng viên để Agent kiểm tra. `--json` xuất cấu trúc đầy đủ; `--full` mở rộng tóm tắt CLI. Danh sách checkpoint mới thay thế danh sách tương ứng trước đó. Tiến trình trên máy không khôi phục toàn bộ chat hay trạng thái riêng của app.

## Hai chế độ kiểm thử

| Chế độ | Thực hiện |
| --- | --- |
| `basic` | Test liên quan và check bắt buộc; lưu bằng chứng; không gọi No-mistakes |
| `full` | Suite đã cấu hình rồi No-mistakes intent/review/test/document/lint |

Không chọn được test đáng tin cậy thì basic báo `blocked`. Test phải chạy thật; compile không chứng minh gameplay đúng. Nguồn đổi sau test làm bằng chứng trở thành `stale`.

Cài No-mistakes không đồng nghĩa bật hoặc vượt qua gate. Full cần Git, `origin`, thay đổi đã commit trên nhánh feature, init gate riêng và agent CLI hoạt động có đăng nhập. Init upstream còn sửa remote/skill cấp user. Đọc [Testing](docs/TESTING.md) trước khi bật. Adapter bỏ rebase/push/PR/CI, không tự approve hoặc merge fix.

## Giới hạn và tài liệu

- Map dựa vào syntax/import/assembly/GUID; runtime, reflection, event và gameplay cần kiểm chứng thêm.
- Coverage ghi file bị loại, quá lớn, binary và lỗi đọc.
- Bộ nhớ CLI và Memory MCP là hai kho riêng.
- Chưa có chuyển tài khoản/model, chuyển toàn bộ chat hay tự đánh thức Agent nền.
- ZIP gồm source và bootstrap; dependency/helper tải khi setup, không phải bộ cài offline đầy đủ.

Xem [Getting started](docs/GETTING_STARTED.md) cho preview, offline reuse, `.tgz`, Lavish và xử lý lỗi. Mẫu cấu hình: [Unity](examples/unity-mobile.json), [Node](examples/node.json).

Mã nguồn AgentMaploom dùng [MIT](LICENSE). Công cụ bên ngoài giữ giấy phép riêng: [Third-party notices](THIRD_PARTY_NOTICES.md).
