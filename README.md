# 围棋实时房间服务

运行：`npm start`，然后打开 `http://localhost:3000`。房间及对局会话持久化在 `data/rooms.json`（可用 `DATA_FILE` 改写），生产环境必须配置随机且保密的 `AUTH_SECRET`。该文件不是静态资源：HTTP 静态站点只会提供首页、`app.js` 和 `style.css`。

## 通信协议

客户端先调用 `POST /api/auth/anonymous` 获得短期签名身份令牌；后续 API 均使用 `Authorization: Bearer <token>`。实时事件使用 `GET /events?token=<token>` 的 Server-Sent Events：`room-list-changed`、`application-arrived`、`application-approved`、`application-rejected` 和 `game-state`。

- `GET/POST /api/rooms`：查询可申请的招募房间或创建房间。
- `POST /api/rooms/:id/applications`：申请加入；`GET /api/rooms/:id/applications`：房主查看待处理申请。
- `POST /api/rooms/:id/applications/:applicationId/approve|reject`：仅房主可处理。批准会在同一持久化更新中占用唯一客人席位并建立对局会话。
- `GET /api/sessions`：返回当前令牌所属的持久化对局和玩家颜色，供页面重新加载后恢复进行中的对局。
- `GET /api/sessions/:id` 与 `PUT /api/sessions/:id/state`：仅对局双方可读写。服务端从令牌推导玩家身份和颜色，校验轮次、棋盘规格、单次落子/停一手，并依据围棋提子和禁入规则计算落子后的棋盘；客户端提交的提子结果必须与服务器计算的结果一致。

服务器记录每手开始时间，并在读取和提交状态时扣除总时间与单手时间。时间耗尽会由服务器结束对局；客户端只负责显示倒计时，不能重置或延长时钟。
