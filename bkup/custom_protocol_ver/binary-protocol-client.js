/**
 * カスタムバイナリプロトコル デコーダー（クライアント用）
 * 転送量を90%以上削減するためのバイナリデシリアライゼーション
 */

const BinaryProtocol = {
    // メッセージタイプ定数
    MSG_TYPE: {
        STATE: 0x01,
        STATE_FULL: 0x02,
        STATE_DELTA: 0x03,
        INIT: 0x10,
        PLAYER_DEATH: 0x20,
        ROUND_START: 0x30,
        ROUND_END: 0x31,
        CHAT: 0x40
    },

    // 色パレット（サーバーと同期）
    COLOR_PALETTE: [
        '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
        '#1abc9c', '#e67e22', '#34495e', '#16a085', '#27ae60',
        '#2980b9', '#8e44ad', '#f1c40f', '#e74c3c', '#95a5a6',
        '#d35400', '#c0392b', '#7f8c8d', '#2c3e50', '#1abc9c'
    ],

    // プレイヤーマッピング
    playerMapping: new Map(),  // index -> {id, name, emoji, team}

    getColorByIndex(idx) {
        return this.COLOR_PALETTE[idx] || '#888888';
    },

    setPlayerMapping(idx, info) {
        this.playerMapping.set(idx, info);
    },

    getPlayerInfo(idx) {
        return this.playerMapping.get(idx) || { id: '', name: '', emoji: '', team: '' };
    },

    // 文字列を読み取り
    readString(dataView, offset) {
        const len = dataView.getUint8(offset);
        const bytes = new Uint8Array(dataView.buffer, offset + 1, len);
        const str = new TextDecoder().decode(bytes);
        return { value: str, newOffset: offset + 1 + len };
    },

    /**
     * バイナリメッセージをデコード
     */
    decode(arrayBuffer) {
        const dataView = new DataView(arrayBuffer);
        const msgType = dataView.getUint8(0);

        switch (msgType) {
            case this.MSG_TYPE.STATE:
            case this.MSG_TYPE.STATE_FULL:
                return this.decodeStateMessage(dataView, msgType === this.MSG_TYPE.STATE_FULL);
            case this.MSG_TYPE.INIT:
                return this.decodeInitMessage(dataView);
            case this.MSG_TYPE.PLAYER_DEATH:
                return this.decodePlayerDeathMessage(dataView);
            case this.MSG_TYPE.ROUND_START:
                return this.decodeRoundStartMessage(dataView);
            case this.MSG_TYPE.CHAT:
                return this.decodeChatMessage(dataView);
            default:
                console.warn('Unknown binary message type:', msgType);
                return null;
        }
    },

    /**
     * STATE メッセージをデコード
     */
    decodeStateMessage(dataView, isFullSync) {
        let offset = 1;

        const timeRemaining = dataView.getUint16(offset, true); offset += 2;
        const playerCount = dataView.getUint8(offset++);

        const players = [];
        for (let i = 0; i < playerCount; i++) {
            const playerIdx = dataView.getUint8(offset++);
            const x = dataView.getUint16(offset, true); offset += 2;
            const y = dataView.getUint16(offset, true); offset += 2;
            const colorIdx = dataView.getUint8(offset++);
            const stateByte = dataView.getUint8(offset++);
            const score = dataView.getUint16(offset, true); offset += 2;
            const trailLen = dataView.getUint8(offset++);

            const trail = [];
            for (let j = 0; j < trailLen; j++) {
                const gx = dataView.getUint8(offset++);
                const gy = dataView.getUint8(offset++);
                trail.push({ x: gx * 10 + 5, y: gy * 10 + 5 });  // GRID_SIZE = 10
            }

            const state = (stateByte >> 4) & 0x0F;
            const invulnerable = stateByte & 0x0F;
            const info = this.getPlayerInfo(playerIdx);

            players.push({
                id: info.id || `p${playerIdx}`,
                x: x,
                y: y,
                color: this.getColorByIndex(colorIdx),
                name: info.name || `Player${playerIdx}`,
                emoji: info.emoji || '😀',
                team: info.team || '',
                score: score,
                state: state === 1 ? 'active' : (state === 0 ? 'dead' : 'waiting'),
                invulnerableCount: invulnerable,
                trail: trail
            });
        }

        let territories = null;
        if (isFullSync) {
            const territoryCount = dataView.getUint16(offset, true); offset += 2;
            territories = [];

            for (let i = 0; i < territoryCount; i++) {
                const tx = dataView.getUint16(offset, true) * 10; offset += 2;  // GRID_SIZE
                const ty = dataView.getUint16(offset, true) * 10; offset += 2;
                const tw = dataView.getUint8(offset++) * 10;
                const th = dataView.getUint8(offset++) * 10;
                const colorIdx = dataView.getUint8(offset++);

                territories.push({
                    x: tx,
                    y: ty,
                    w: tw,
                    h: th,
                    color: this.getColorByIndex(colorIdx),
                    ownerId: '',  // バイナリでは省略
                    points: [
                        { x: tx, y: ty },
                        { x: tx + tw, y: ty },
                        { x: tx + tw, y: ty + th },
                        { x: tx, y: ty + th }
                    ]
                });
            }

            // マッピングデータ（拡張）
            if (offset < dataView.byteLength) {
                const mappingCount = dataView.getUint8(offset++);
                if (mappingCount > 0) {
                    for (let i = 0; i < mappingCount; i++) {
                        const pid = dataView.getUint8(offset++);
                        const { value: id, newOffset: no1 } = this.readString(dataView, offset); offset = no1;
                        const { value: name, newOffset: no2 } = this.readString(dataView, offset); offset = no2;
                        const { value: emoji, newOffset: no3 } = this.readString(dataView, offset); offset = no3;
                        const { value: team, newOffset: no4 } = this.readString(dataView, offset); offset = no4;

                        this.updatePlayerMapping(pid, id, name, emoji, team);

                        // 既に読み込んだプレイヤーリストの名前を更新
                        const targetP = players.find(p => p.id === id || p.id === `p${pid}`);
                        if (targetP) {
                            targetP.name = name;
                            targetP.emoji = emoji;
                            targetP.team = team;
                        }
                    }
                }
            }
        }

        return {
            type: 'state',
            players: players,
            time: timeRemaining,
            teams: [],  // TODO: チーム情報
            territories: territories
        };
    },

    /**
     * INIT メッセージをデコード
     */
    decodeInitMessage(dataView) {
        let offset = 1;

        const myPlayerIdx = dataView.getUint8(offset++);
        const myColorIdx = dataView.getUint8(offset++);
        const worldWidth = dataView.getUint16(offset, true); offset += 2;
        const worldHeight = dataView.getUint16(offset, true); offset += 2;
        const mode = dataView.getUint8(offset++) === 1 ? 'TEAM' : 'SOLO';

        // 障害物
        const obstacleCount = dataView.getUint8(offset++);
        const obstacles = [];
        for (let i = 0; i < obstacleCount; i++) {
            obstacles.push({
                x: dataView.getUint16(offset, true),
                y: dataView.getUint16(offset + 2, true),
                w: dataView.getUint16(offset + 4, true),
                h: dataView.getUint16(offset + 6, true)
            });
            offset += 8;
        }

        // テリトリー
        const territoryCount = dataView.getUint16(offset, true); offset += 2;
        const territories = [];
        for (let i = 0; i < territoryCount; i++) {
            const tx = dataView.getUint16(offset, true) * 10; offset += 2;
            const ty = dataView.getUint16(offset, true) * 10; offset += 2;
            const tw = dataView.getUint8(offset++) * 10;
            const th = dataView.getUint8(offset++) * 10;
            const colorIdx = dataView.getUint8(offset++);

            territories.push({
                x: tx, y: ty, w: tw, h: th,
                color: this.getColorByIndex(colorIdx),
                ownerId: '',
                points: [
                    { x: tx, y: ty },
                    { x: tx + tw, y: ty },
                    { x: tx + tw, y: ty + th },
                    { x: tx, y: ty + th }
                ]
            });
        }

        // プレイヤーマッピング
        const mappingCount = dataView.getUint8(offset++);
        let myId = '';
        for (let i = 0; i < mappingCount; i++) {
            const idx = dataView.getUint8(offset++);
            const idResult = this.readString(dataView, offset); offset = idResult.newOffset;
            const nameResult = this.readString(dataView, offset); offset = nameResult.newOffset;
            const emojiResult = this.readString(dataView, offset); offset = emojiResult.newOffset;
            const teamResult = this.readString(dataView, offset); offset = teamResult.newOffset;

            this.setPlayerMapping(idx, {
                id: idResult.value,
                name: nameResult.value,
                emoji: emojiResult.value,
                team: teamResult.value
            });

            if (idx === myPlayerIdx) {
                myId = idResult.value;
            }
        }

        return {
            type: 'init',
            id: myId || `p${myPlayerIdx}`,
            color: this.getColorByIndex(myColorIdx),
            emoji: '😀',  // TODO
            world: { width: worldWidth, height: worldHeight },
            mode: mode,
            obstacles: obstacles,
            territories: territories,
            teams: []
        };
    },

    /**
     * PLAYER_DEATH メッセージをデコード
     */
    decodePlayerDeathMessage(dataView) {
        let offset = 1;
        const playerIdx = dataView.getUint8(offset++);
        const reasonResult = this.readString(dataView, offset);
        const info = this.getPlayerInfo(playerIdx);

        return {
            type: 'player_death',
            id: info.id || `p${playerIdx}`,
            reason: reasonResult.value
        };
    },

    /**
     * ROUND_START メッセージをデコード
     */
    decodeRoundStartMessage(dataView) {
        let offset = 1;
        const mode = dataView.getUint8(offset++) === 1 ? 'TEAM' : 'SOLO';
        const worldWidth = dataView.getUint16(offset, true); offset += 2;
        const worldHeight = dataView.getUint16(offset, true); offset += 2;

        const obstacleCount = dataView.getUint8(offset++);
        const obstacles = [];
        for (let i = 0; i < obstacleCount; i++) {
            obstacles.push({
                x: dataView.getUint16(offset, true),
                y: dataView.getUint16(offset + 2, true),
                w: dataView.getUint16(offset + 4, true),
                h: dataView.getUint16(offset + 6, true)
            });
            offset += 8;
        }

        return {
            type: 'round_start',
            mode: mode,
            world: { width: worldWidth, height: worldHeight },
            obstacles: obstacles
        };
    },

    /**
     * CHAT メッセージをデコード
     */
    decodeChatMessage(dataView) {
        let offset = 1;
        const colorIdx = dataView.getUint8(offset++);
        const nameResult = this.readString(dataView, offset); offset = nameResult.newOffset;
        const textResult = this.readString(dataView, offset);

        return {
            type: 'chat',
            color: this.getColorByIndex(colorIdx),
            name: nameResult.value,
            text: textResult.value
        };
    }
};

// グローバルに公開
if (typeof window !== 'undefined') {
    window.BinaryProtocol = BinaryProtocol;
}
