# 围棋实时房间服务

运行：`npm start`，然后打开 `http://localhost:3000`。房间及对局会话持久化在 `data/rooms.json`（可用 `DATA_FILE` 改写），生产环境必须配置随机且保密的 `AUTH_SECRET`。

## 通信协议

客户端先调用 `POST /api/auth/anonymous` 获得短期签名身份令牌；后续 API 均使用 `Authorization: Bearer <token>`。实时事件使用 `GET /events?token=<token>` 的 Server-Sent Events：`room-list-changed`、`application-arrived`、`application-approved`、`application-rejected` 和 `game-state`。

- `GET/POST /api/rooms`：查询可申请的招募房间或创建房间。
- `POST /api/rooms/:id/applications`：申请加入；`GET /api/rooms/:id/applications`：房主查看待处理申请。
- `POST /api/rooms/:id/applications/:applicationId/approve|reject`：仅房主可处理。批准会在同一持久化更新中占用唯一客人席位并建立对局会话。
- `GET /api/sessions/:id` 与 `PUT /api/sessions/:id/state`：仅对局双方可读写。服务端从令牌推导玩家身份和颜色，并校验轮次、落子数量、棋盘规格及不可修改已有棋子。
