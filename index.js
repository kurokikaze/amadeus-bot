// @flow
/* global readline */

const ROLE_SCOUT = 0;
const ROLE_DIGGER = 1;

// Точки на которые будут ставится радары. Берутся по порядку снизу вверх.
const prospectorPoints = [
    { x: 29, y: 11 },
    { x: 23, y: 12 },
    { x: 23, y: 3 },
    { x: 1, y: 10 },
    { x: 19, y: 8 },
    { x: 15, y: 12 },
    { x: 9, y: 0 },
    { x: 14, y: 4 },
    { x: 6, y: 13 },
    { x: 10, y: 9 },
    { x: 5, y: 5 },
];

function flatten(ary) {
    let ret = [];
    for (let i = 0; i < ary.length; i += 1) {
        if (Array.isArray(ary[i])) {
            ret = ret.concat(flatten(ary[i]));
        } else {
            ret.push(ary[i]);
        }
    }
    return ret;
}

// Находит клетки с известной рудой и упорядочивает по близости к базе (левый край)
const findVeins = (map) => flatten(map).filter((cell) => cell.ore > 0).sort((a, b) => a.x - b.x);

const dist = ({ x: x1, y: y1 }, { x: x2, y: y2 }) => Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);

// Сдвигает точку в зависимости от id робота - 1 идёт налево, 2 наверх, 3 направо и 4 вниз
// Изначально в режиме PROSPECTING роботы так раскапывали неизвестные клетки - каждый в
// своём направлении
const getShiftedPoi = (id, { x, y }) => {
    switch (id) {
    case 1:
        return { x: x - 1, y };
    case 2:
        return { x, y: y - 1 };
    case 3:
        return { x: x + 1, y };
    case 4:
        return { x, y: y + 1 };
    default:
        return { x, y };
    }
};

/*
 *  Диспетчер. Здесь всё взаимодействие между роботами.
 */
class Dispatcher {
    constructor() {
        this.robots = [];
    }

    register(robot) {
        this.robots.push(robot);
    }

    // Выводит всех роботов из определённого режима.
    // Чаще всего из режима случайного поиска как только будут обнаружены клетки с рудой
    unsetMode(mode) {
        if (this.robots && this.robots.length > 0) {
            for (const robot of this.robots) {
                console.error(`Robot ${robot.id} is in mode ${robot.getMode()}`);
                if (robot.getMode() === mode) {
                    console.error(`Resetting mode for robot ${robot.id}`);
                    robot.resetMode();
                }
            }
        } else {
            console.error('Misconfiguration of Dispatcher');
        }
    }

    // Назначает переданного робота скаутом
    setScout(robotScout) {
        for (const robot of this.robots) {
            if (robot.id === robotScout.id) {
                robot.setRole(ROLE_SCOUT);
            } else {
                if (robot.role === ROLE_SCOUT) {
                    robot.setRole(ROLE_DIGGER);
                }
                robot.setLeader(robotScout);
            }
        }
    }

    // Проверяем не погиб ли наш скаут
    isScoutDead() {
        for (const robot of this.robots) {
            if (robot.role === ROLE_SCOUT && robot.x === -1 && robot.y === -1) {
                return true;
            }
        }
        return false;
    }

    // Список живых роботов
    // Второе условие с ошибкой, но по первому всё равно фильтрует правильно
    getAliveRobot() {
        return this.robots.find((r) => r.x !== -1 && r.x !== -2);
    }
}

class Robot {
    constructor(id) {
        this.id = id;
        // Изначально скаут выбирается именно так
        this.role = (id === 0) ? ROLE_SCOUT : ROLE_DIGGER;

        this.poi = { x: 12, y: 6 };

        // Этот режим был вместо режима PROSPECTOR - пока скаут получает радар и едет
        // с ним на точку, роботы собираются вокруг точки закладки радара
        // (чтобы быстрее приступить к добыче)
        this.mode = (id === 0) ? '' : 'MOVE_AND_WAIT';
    }

    // Ставит POI робота на клетку с рудой, соответствующую его номеру
    setPoiToMyVein() {
        const veins = findVeins(this.map);
        const myPriority = this.getMyPriority();
        if (veins.length > 0 && veins[myPriority]) {
            this.poi = { x: veins[myPriority].x, y: veins[myPriority].y };
            return true;
        }
        return false;
    }

    isDead() {
        return this.x === -1 && this.y === -1;
    }

    // При смене роли режим обнуляется. Общих режимов у ролей всё равно нет.
    setRole(role) {
        this.role = role;
        this.mode = '';
    }

    // Устанавливает POI когда нет разведанной руды. 
    // Роботы встают "крестом" вокруг POI лидера (для копателей это скаут)
    setBackupPoi() {
        if (this.leader && this.leader.poi && this.leader.poi.x > 0) {
            this.mode = 'PROSPECTING';
            this.poi = getShiftedPoi(this.id, { x: this.leader.poi.x, y: this.leader.poi.y });
        } else {
            this.poi = { x: 15, y: 6 };
        }
    }

    getMyPriority() {
        return this.role === ROLE_DIGGER ? (this.id - 1) : 4;
    }

    getMode() {
        return this.mode;
    }

    resetMode() {
        console.error(`Robot #${this.id} resetting mode from ${this.mode}`);
        this.mode = '';
    }

    setLeader(robot) {
        this.leader = robot;
    }

    setGameId(gameId) {
        this.gameId = gameId;
    }

    onPoi() {
        return this.poi && (this.x === this.poi.x && this.y === this.poi.y);
    }

    // Можно ли копать на POI с текущей позиции.
    // В первом варианте (выше) роботы заезжали прямо на POI прежде чем копать.
    // Это не самый эффективный вариант
    poiReachable() {
        return dist(this, this.poi) <= 1;
    }

    setPointOfInterest(x, y) {
        this.poi = { x, y };
    }

    setGameData({ x, y, item }) {
        this.x = x;
        this.y = y;
        this.item = item;
    }

    setMap(map) {
        this.map = map;
    }

    // Здесь одним большим куском лежат деревья выбора для ролей
    // Я думал их разбить на отдельные методы, но руки так и не дошли
    getCommand() {
        if (this.x === -1 && this.y === -1) {
            return 'WAIT'; // Don't waste time on dead
        }
        switch (this.role) {
        // Скаут. Берёт радар, закапывает его
        case ROLE_SCOUT:
            // После закапывания выкапывает руду по дороге,
            // чтобы не возвращаться порожняком
            if (this.mode === 'DIG_AFTER_SCOUTING') {
                if (this.item === -1) {
                    this.setPoiToMyVein();
                    if (this.poiReachable()) {
                        this.mode = '';
                        const digPoint = {
                            x: this.poi.x,
                            y: this.poi.y,
                        };
                        this.poi = { x: 0, y: this.y };
                        return `DIG ${digPoint.x} ${digPoint.y}`;
                    }
                    return `MOVE ${this.poi.x} ${this.poi.y}`;
                }
                this.mode = '';
                this.poi = { x: 0, y: this.y };
                return `MOVE ${this.poi.x} ${this.poi.y}`;
            }
            console.error(`Scout status: ${this.x}, ${this.y} : ${this.item}`);
            if (this.item === -1) {
                if (this.x === 0) {
                    if (prospectorPoints.length > 0) {
                        const point = prospectorPoints.pop();
                        this.poi = { x: point.x, y: point.y };
                    }
                    console.error(`Dispatching RESET WAIT to ${global.dispatcher.robots.length} robots`);
                    global.dispatcher.unsetMode('WAIT_FOR_ORE');
                    return 'REQUEST RADAR';
                }
                if (prospectorPoints.length === 0) {
                    this.role = ROLE_DIGGER;
                    this.setPoiToMyVein();
                    return `MOVE ${this.poi.x} ${this.poi.y}`;
                }
                this.poi = { x: 0, y: this.y };
                return `MOVE ${this.poi.x} ${this.poi.y}`;
            }

            if (!this.poiReachable()) {
                return `MOVE ${this.poi.x} ${this.poi.y}`;
            }
            // Do not return empty
            this.mode = 'DIG_AFTER_SCOUTING';
            // Remove WAIT_FOR_ORE mode so if no ore is found, diggers will follow Scout
            return `DIG ${this.poi.x} ${this.poi.y}`;
        /* Копатель. Режимы:
         * WAIT_FOR_ORE - сгрудиться вокруг будущей точки закладки радара и ждать 
         * MOVE_AND_WAIT - ехать к точке закладки радара (как доехали, перейти в режим WAIT_FOR_ORE)
         * PROSPECTING - случайное копание, пока радар не показал клеток с рудой
         */
        case ROLE_DIGGER:
            if (this.mode === 'WAIT_FOR_ORE') {
                const result = this.setPoiToMyVein();
                if (result) {
                    this.mode = '';
                    return `MOVE ${this.poi.x} ${this.poi.y}`;
                }

                return 'WAIT';
            }
            if (this.mode === 'MOVE_AND_WAIT' && this.onPoi()) {
                this.mode = 'WAIT_FOR_ORE';
                return 'WAIT';
            }

            if (this.item === -1) {
                if (this.x === 0) {
                    const result = this.setPoiToMyVein();
                    if (result) {
                        this.mode = '';
                    } else {
                        this.setBackupPoi();
                    }
                    return `MOVE ${this.poi.x} ${this.poi.y}`;
                }

                if (this.poi.x === 0) {
                    const result = this.setPoiToMyVein();
                    if (result) {
                        this.mode = '';
                    } else {
                        this.setBackupPoi();
                    }
                }

                if (!this.poiReachable()) {
                    return `MOVE ${this.poi.x} ${this.poi.y}`;
                }

                const digPoint = {
                    x: this.poi.x,
                    y: this.poi.y,
                };
                    // this.poi = {x: 0, y: this.y};
                if (this.mode === 'PROSPECTING') {
                    if (findVeins(this.map).length > 0) {
                        const result = this.setPoiToMyVein();
                        if (!result) {
                            this.poi = getShiftedPoi(this.id, this.poi);
                        } else {
                            this.resetMode();
                        }
                    } else {
                        this.poi = getShiftedPoi(this.id, this.poi);
                    }
                }

                return `DIG ${digPoint.x} ${digPoint.y}`;
            }

            if (this.x === 0) {
                const result = this.setPoiToMyVein();
                if (!result) {
                    this.setBackupPoi();
                }
                return `MOVE ${this.poi.x} ${this.poi.y}`;
            }

            this.poi = { x: 0, y: this.y };

            if (this.mode === 'PROSPECTING') {
                this.resetMode();
            }
            return `MOVE ${this.poi.x} ${this.poi.y}`;
        default:
            return 'WAIT';
        }
    }
}

const ENTITY_ROBOT = 0;

const mapDataInputs = readline().split(' ');
const width = parseInt(mapDataInputs[0], 10);
const height = parseInt(mapDataInputs[1], 10); // size of the map

const readEntity = () => {
    const entityInputs = readline().split(' ');
    const id = parseInt(entityInputs[0], 10); // unique id of the entity
    // 0 for your robot, 1 for other robot, 2 for radar, 3 for trap
    const type = parseInt(entityInputs[1], 10);
    const x = parseInt(entityInputs[2], 10);
    const y = parseInt(entityInputs[3], 10); // position of the entity
    // if this entity is a robot, the item it is carrying
    // (-1 for NONE, 2 for RADAR, 3 for TRAP, 4 for ORE)
    const item = parseInt(entityInputs[4], 10);
    return {
        id,
        type,
        x,
        y,
        item,
    };
};

const readEntityData = () => {
    const inputs = readline().split(' ');
    const entityCount = parseInt(inputs[0], 10); // number of entities visible to you
    const radarCooldown = parseInt(inputs[1], 10); // turns left until a new radar can be requested
    const trapCooldown = parseInt(inputs[2], 10); // turns left until a new trap can be requested

    return {
        entityCount,
        radarCooldown,
        trapCooldown,
    };
};

const readMap = () => {
    const map = [];
    for (let i = 0; i < height; i += 1) {
        const inputs = readline().split(' ');
        map[i] = [];
        for (let j = 0; j < width; j += 1) {
            const ore = inputs[2 * j];// amount of ore or "?" if unknown
            const hole = parseInt(inputs[2 * j + 1], 10);// 1 if cell has a hole
            map[i][j] = {
                x: j,
                y: i,
                ore,
                hole,
            };
        }
    }
    return map;
};

const myRobots = [];
const entities = [];

global.dispatcher = new Dispatcher();

for (let i = 0; i < 5; i += 1) {
    myRobots[i] = new Robot(i);
    if (i > 0) {
        myRobots[i].setLeader(myRobots[0]);
    }
    global.dispatcher.register(myRobots[i]);
}

// game loop
while (true) {
    /* eslint-disable no-unused-vars */
    const inputs = readline().split(' ');
    const myScore = parseInt(inputs[0], 10); // Amount of ore delivered
    const opponentScore = parseInt(inputs[1], 10);
    const map = readMap();
    const {
        entityCount,
        radarCooldown,
        trapCooldown,
    } = readEntityData();
    /* eslint-enable no-unused-vars */
    let myRobotIndex = 0;
    for (let i = 0; i < entityCount; i += 1) {
        const entity = readEntity();
        if (entity.type === ENTITY_ROBOT) {
            myRobots[myRobotIndex].setGameId(entity.id);
            myRobots[myRobotIndex].setGameData(entity);
            myRobots[myRobotIndex].setMap(map);
            myRobotIndex += 1;
        }
        entities.push(entity);
    }
    if (global.dispatcher.isScoutDead()) {
        global.dispatcher.setScout(global.dispatcher.getAliveRobot());
    }
    for (let i = 0; i < 5; i += 1) {
        console.log(myRobots[i].getCommand());
    }
}
