/**
 * Deliver more ore to hq (left side of the map) than your opponent.
 * Use radars to find ore but beware of traps!
 * */
const ROLE_SCOUT = 0;
const ROLE_DIGGER = 1;
const ROLE_MINER = 2;

const roleMap = {
    0: 'Scout',
    1: 'Digger',
    2: 'Miner',
};

const closest = (a, b) => a.dist - b.dist;

const ITEM_NOTHING = -1;
const ITEM_TRAP = 3;
const ITEM_ORE = 4;

const LEFT_PROSPECTING_BORDER = 7;

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
    for (let i = 0; i < ary.length; i++) {
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

const dist = ({ x: x1, y: y1 }, { x: x2, y: y2 }) => Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));

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
        this.map = [];
        for (let x = 0; x < 30; x += 1) {
            for (let y = 0; y < 15; y += 1) {
                this.map.push({
                    x, y, ore: -1, hole: 0,
                });
            }
        }
        this.takenCells = [];
        this.forbiddenCells = [];
        this.foundMiner = false;
    }

    // Возвращает возможные места для установки ловушек
    // (ore > 1 потому что 1 мы выкопаем при установке ловушки,
    // и остаток должен быть виден на вражеских радарах)
    getMineablePlaces() {
        return this.map.filter((cell) => cell.x > 10
            && cell.ore > 1
            && this.numOfTaken(cell) === 0).filter((cell) => !this.isForbidden(cell));
    }

    // превращает одного из копателей в диверсанта
    designateMiner() {
        console.error('DESIGNATING MINER');
        if (this.foundMiner) {
            return false;
        }
        const candidates = this.robots.filter((robot) => (robot.item === ITEM_NOTHING || robot.item === ITEM_ORE)
            && robot.role === ROLE_DIGGER
            && robot.x > -1
            && robot.y > -1);
        const mineablePlaces = this.getMineablePlaces();
        if (candidates.length > 0 && mineablePlaces.length > 0) {
            candidates.sort((a, b) => a.x - b.x);
            candidates[0].setRole(ROLE_MINER);
            candidates[0].poi = {
                x: mineablePlaces[0].x,
                y: mineablePlaces[0].y,
            };
            console.error(`MINER IS ROBOT ${candidates[0].id}, trap will be set to ${mineablePlaces.x}, ${mineablePlaces.y}`);
            this.forbidCell({ x: mineablePlaces[0].x, y: mineablePlaces[0].y });
            this.foundMiner = true;
            return true;
        }
        if (candidates.length === 0) {
            console.error('No candidates');
        }
        if (mineablePlaces.length === 0) {
            console.error('No mineable places');
        }

        return false;
    }

    updateMap(map) {
        const flatMap = flatten(map);
        const locator = (cell) => (c) => c.x === cell.x && c.y === cell.y;

        for (const cell of flatMap) {
            const cellPos = this.map.findIndex(locator(cell));
            this.map[cellPos].ore = cell.ore;
            this.map[cellPos].hole = cell.hole;
        }
    }

    // Находит клетки, на которых назначено больше роботов чем там осталось руды
    // Перенаправляет лишних роботов в другие места
    findSlackers() {
        const unclaimed = this.getUnclaimedOre();
        // No point of doing anything if there are no known resources
        if (unclaimed.length > 0) {
            for (const robot of this.robots) {
                const hisPoi = robot.poi;
                // Don't bother scouts and returning bots
                if (hisPoi.x > 0 && robot.role === ROLE_DIGGER) {
                    const poiCell = this.map.find(
                        (cell) => cell.x === hisPoi.x && cell.y === hisPoi.y,
                    );
                    const contestants = this.takenCells.filter(
                        (cell) => cell.x === poiCell.x && cell.y === poiCell.y,
                    ).length;
                    if (poiCell.ore < contestants && poiCell.ore !== -1) {
                        console.error(`Redirecting robot ${robot.id} because of conflict`);
                        const closestToRobot = unclaimed.map((cell) => ({
                            x: cell.x,
                            y: cell.y,
                            dist: Math.abs(cell.x - robot.x) + Math.abs(cell.y - robot.y),
                        })).sort(closest)[0];

                        this.freeCell(robot.id);
                        robot.resetMode();
                        robot.poi = {
                            x: closestToRobot.x,
                            y: closestToRobot.y,
                        };
                    }
                }
            }
        }
    }

    // Возвращает клетки с рудой (незанятые и не запрещённые)
    getUnclaimedOre() {
        return this.map.filter(
            (cell) => (cell.ore - this.numOfTaken(cell) - this.numOfForbidden(cell)) > 0,
        );
    }

    getClosestOre({ x, y }) {
        const cells = this.getUnclaimedOre()
            .map((cell) => ({
                x: cell.x,
                y: cell.y,
                ore: cell.ore,
                dist: dist({ x, y }, cell),
            }));
        if (cells.length > 0) {
            [...cells].sort(closest);
            return cells[0];
        }

        return false;
    }

    // Запрещает клетку для всякого копания. Скорее всего там будет установлена мина
    forbidCell({ x, y }) {
        this.forbiddenCells.push({ x, y });
    }

    isForbidden({ x, y }) {
        return this.forbiddenCells.filter((cell) => cell.x === x && cell.y === y).length > 0;
    }

    numOfForbidden({ x, y }) {
        return this.forbiddenCells.filter((cell) => cell.x === x && cell.y === y).length * 20;
    }

    // Возвращает ближайшее нераскопанное место, для которого запасы руды неизвестны
    // Так выбирают цели роботы в режиме PROSPECTING
    getClosestUnknownFlat({ x, y }) {
        const cells = this.map
            .filter(
                (cell) => this.numOfTaken(cell) === 0 && cell.ore === -1 && cell.hole === 0 && cell.x >= LEFT_PROSPECTING_BORDER && !this.isForbidden(cell),
            )
            .map((cell) => ({
                x: cell.x,
                y: cell.y,
                dist: Math.abs(x - cell.x) + Math.abs(y - cell.y),
            }));
        if (cells.length > 0) {
            [...cells].sort(closest);
            return cells[0];
        }
        return [];
    }

    // Отмечаем занятие клетки роботом (будет там копать)
    takeCell(x, y, id) {
        console.error(`Robot ${id} taking cell ${x}, ${y}`);
        this.takenCells.push({ x, y, id });
    }

    // Сколько роботов заняли клетку по координатам
    numOfTaken({ x, y }) {
        return this.takenCells.filter((entry) => entry.x === x && entry.y === y).length;
    }

    getOurTaken(id) {
        return this.takenCells.find((e) => e.id === id);
    }

    freeCell(id) {
        console.error(`Robot ${id} freeing his cells (${this.takenCells.filter((entry) => entry.id === id).length})`);
        this.takenCells = this.takenCells.filter((entry) => entry.id !== id);
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
        this.role = (id === 0) ? ROLE_SCOUT : ROLE_DIGGER;

        this.poi = { x: 12, y: 6 };

        // Этот режим был вместо режима PROSPECTOR - пока скаут получает радар и едет
        // с ним на точку, роботы собираются вокруг точки закладки радара
        // (чтобы быстрее приступить к добыче)
        this.mode = (id === 0) ? '' : 'MOVE_AND_WAIT';
    }

    // Получаем ближайшую недозанятую руду, и занимаем её для копания
    setPoiToMyVein() {
        /* const veins = findVeins(this.map);
        const myPriority = this.getMyPriority();
        if (veins.length > 0 && veins[myPriority]) {
            this.poi = {x: veins[myPriority].x, y: veins[myPriority].y};
             return true;
        }
        return false; */
        const takenVein = global.dispatcher.getOurTaken(this.id);
        if (!takenVein) {
            const nearestVein = global.dispatcher.getClosestOre(this);
            if (nearestVein) {
                console.error(`Robot #${this.id} got vein ${nearestVein.x}, ${nearestVein.y} as closest (now taken by ${global.dispatcher.numOfTaken(nearestVein)} robots)`);
                this.poi = {
                    x: nearestVein.x,
                    y: nearestVein.y,
                };
                global.dispatcher.takeCell(this.poi.x, this.poi.y, this.id);
                return true;
            }
            return false;
        }
        console.error(`Robot #${this.id} staying at vein ${takenVein.x}, ${takenVein.y}`);
        this.poi = {
            x: takenVein.x,
            y: takenVein.y,
        };
        return true;
    }

    isDead() {
        return this.x === -1 && this.y === -1;
    }

    // При смене роли режим обнуляется. Общих режимов у ролей всё равно нет.
    setRole(role) {
        this.role = role;
        this.mode = '';
    }

    // Устанавливает POI когда нет разведанной руды
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

    // Можно ли подвигаться так чтобы в следующий ход сразу начать копать
    canMoveCloserToAction({ x, y }) {
        if (Math.abs(this.x - x) + Math.abs(this.y - y) === 5 && x > 0) {
            // can move closer
            // from east
            if (Math.abs(this.x - x - 1) + Math.abs(this.y - y) === 4) {
                return { x: x - 1, y };
            }

            // from north
            if (Math.abs(this.x - x) + Math.abs(this.y - y - 1) === 4) {
                return { x, y: y - 1 };
            }

            // from south
            if (Math.abs(this.x - x) + Math.abs(this.y - y + 1) === 4) {
                return { x, y: y + 1 };
            }

            if (Math.abs(this.x - x + 1) + Math.abs(this.y - y) === 4) {
                return { x: x + 1, y };
            }
        }
    }

    getMoveToPoiCommand() {
        const closer = this.canMoveCloserToAction(this.poi);
        if (closer) {
            return `MOVE ${closer.x} ${closer.y}`;
        }
        return `MOVE ${this.poi.x} ${this.poi.y}`;
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

    getShiftedPoi({ x, y }) {
        let poi = { x, y };

        switch (this.id) {
        case 1:
            poi = { x: x - 1, y };
            break;
        case 2:
            poi = { x, y: y - 1 };
            break;
        case 3:
            poi = { x: x + 1, y };
            break;
        case 4:
            poi = { x, y: y + 1 };
            break;
        default:
            poi = { x, y };
        }

        if (x <= 0 || x > 29 || y < 0 || y > 14) {
            if (prospectorPoints.length > 0) {
                const nextProspectorPoint = prospectorPoints[prospectorPoints.length - 1];
                poi = { x: nextProspectorPoint.x, y: nextProspectorPoint.y };
            } else {
                this.resetMode();
                poi = { x: 14, y: 7 };
            }
        }

        return poi;
    }

    setMap(map) {
        this.map = map;
    }

    // Устанавливаем POI в ближайшую неразведанную точку
    setPoiToProspecting() {
        const nearestUnknown = global.dispatcher.getClosestUnknownFlat(this);
        console.error(`Nearest unknown to point ${this.x} ${this.y} is ${nearestUnknown.x} ${nearestUnknown.y}`);

        if (findVeins(this.map).length > 0) {
            const result = this.setPoiToMyVein();
            if (!result) {
                if (nearestUnknown) {
                    this.poi = nearestUnknown;
                    global.dispatcher.takeCell(nearestUnknown.x, nearestUnknown.y, this.id);
                } else {
                    this.poi = this.getShiftedPoi(this.poi);
                    global.dispatcher.takeCell(this.poi.x, this.poi.y, this.id);
                }
            } else {
                this.resetMode();
            }
        } else if (nearestUnknown) {
            this.poi = nearestUnknown;
            global.dispatcher.takeCell(nearestUnknown.x, nearestUnknown.y, this.id);
        } else {
            this.poi = this.getShiftedPoi(this.poi);
            global.dispatcher.takeCell(this.poi.x, this.poi.y, this.id);
        }
    }

    // Здесь одним большим куском лежат деревья выбора для ролей
    // Я думал их разбить на отдельные методы, но руки так и не дошли
    getCommand() {
        if (this.x === -1 && this.y === -1) {
            return 'WAIT'; // Don't waste time on dead
        }
        switch (this.role) {
        // Диверсант. Получает и закапывает мины
        case ROLE_MINER:
            if (this.item !== ITEM_TRAP) {
                if (this.x === 0) {
                    return 'REQUEST TRAP';
                }
                return `MOVE 0 ${this.y}`;
            }
            if (this.poiReachable()) {
                // Still good to trap!
                const stillHasOre = global.dispatcher.map.find(
                    (cell) => cell.x === this.poi.x && cell.y === this.poi.y,
                ).ore > 1;
                if (stillHasOre) {
                    const trapPoint = {
                        x: this.poi.x,
                        y: this.poi.y,
                    };

                    const places = global.dispatcher.getMineablePlaces().map((cell) => ({
                        x: cell.x,
                        y: cell.y,
                        dist: Math.abs(cell.x - this.x) + Math.abs(cell.y - this.y),
                    })).sort(closest);

                    if (places.length > 0) {
                        global.dispatcher.forbidCell(places[0]);
                        this.poi = {
                            x: places[0].x,
                            y: places[0].y,
                        };
                    } else {
                        this.setRole(ROLE_DIGGER);
                        this.setPoiToMyVein();
                    }

                    return `DIG ${trapPoint.x} ${trapPoint.y}`;
                }
                const places = global.dispatcher.getMineablePlaces().map((cell) => ({
                    x: cell.x,
                    y: cell.y,
                    dist: Math.abs(cell.x - this.x) + Math.abs(cell.y - this.y),
                })).sort(closest);

                if (places.length > 0) {
                    global.dispatcher.forbidCell(places[0]);
                    this.poi = {
                        x: places[0].x,
                        y: places[0].y,
                    };
                    if (this.poiReachable()) {
                        const trapCell = {
                            x: this.poi.x,
                            y: this.poi.y,
                        };
                        if (places.length > 1) {
                            global.dispatcher.forbidCell(places[1]);
                            this.poi = {
                                x: places[1].x,
                                y: places[1].y,
                            };
                        } else {
                            this.setRole(ROLE_DIGGER);
                        }
                        return `DIG ${trapCell.x} ${trapCell.y}`;
                    }

                    return this.getMoveToPoiCommand();
                }
                this.setRole(ROLE_DIGGER);
                this.setPoiToMyVein();
                // Dig the mine!
                return `DIG ${this.x - 1} ${this.y}`;
            }
            return this.getMoveToPoiCommand();
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
                    } else {
                        // Вот тут непонятно что я имел в виду
                    }
                } else {
                    this.mode = '';
                    this.poi = { x: 0, y: this.y };
                    return this.getMoveToPoiCommand();
                }
            }
            console.error(`Scout status: ${this.x}, ${this.y} : ${this.item}`);
            if (this.item === -1) {
                if (this.x === 0) {
                    if (prospectorPoints.length > 0) {
                        const point = prospectorPoints.pop();
                        this.poi = { x: point.x, y: point.y };
                    } else {
                        this.role = ROLE_DIGGER;
                        this.setPoiToMyVein();
                        return this.getMoveToPoiCommand();
                    }
                    console.error(`Dispatching RESET WAIT to ${global.dispatcher.robots.length} robots`);
                    global.dispatcher.unsetMode('WAIT_FOR_ORE');
                    return 'REQUEST RADAR';
                }
                if (prospectorPoints.length === 0) {
                    this.role = ROLE_DIGGER;
                    this.setPoiToMyVein();
                    return this.getMoveToPoiCommand();
                }
                this.poi = { x:0, y: this.y };
                return `MOVE ${this.poi.x} ${this.poi.y}`;
            }
            if (!this.poiReachable()) {
                return this.getMoveToPoiCommand();
            }
            // Do not return empty
            this.mode = 'DIG_AFTER_SCOUTING';
            // Remove WAIT_FOR_ORE mode so if no ore is found, diggers will follow Scout
            const digPoint = {
                x: this.poi.x,
                y: this.poi.y,
            };
            global.dispatcher.freeCell(this.id);
            return `DIG ${digPoint.x} ${digPoint.y}`;
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
                    if (!this.poiReachable()) {
                        return this.getMoveToPoiCommand();
                    }
                    return `DIG ${this.poi.x} ${this.poi.y}`;
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
                    return this.getMoveToPoiCommand();
                }
                const digPoint = {
                    x: this.poi.x,
                    y: this.poi.y,
                };
                // Prospecting
                global.dispatcher.freeCell(this.id);
                this.setPoiToProspecting();
                return `DIG ${digPoint.x} ${digPoint.y}`;
            }

            if (this.x === 0) {
                const result = this.setPoiToMyVein();
                if (!result) {
                    this.setBackupPoi();
                }
                if (!this.poiReachable()) {
                    return this.getMoveToPoiCommand();
                }
                return `DIG ${this.poi.x} ${this.poi.y}`;
            }
            this.poi = { x: 0, y: this.y };
            if (this.mode === 'PROSPECTING') {
                this.resetMode();
            }
            if (!this.poiReachable()) {
                return this.getMoveToPoiCommand();
            }
            return `DIG ${this.poi.x} ${this.poi.y}`;
        default:
            return 'WAIT';
        }
    }
}

const ENTITY_ROBOT = 0;
const ENTITY_ENEMY = 1;
const ENTITY_RADAR = 2;
const ENTITY_TRAP = 3;
const ENTITY_ORE = 4;

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
            const ore = inputs[2 * j] === '?' ? -1 : parseInt(inputs[2 * j], 10);// amount of ore or "?" if unknown
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
    const inputs = readline().split(' ');
    const myScore = parseInt(inputs[0], 10); // Amount of ore delivered
    const opponentScore = parseInt(inputs[1], 10);
    const map = readMap();
    global.dispatcher.updateMap(map);
    const {
        entityCount,
        radarCooldown,
        trapCooldown,
    } = readEntityData();
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

    global.dispatcher.findSlackers();

    if (global.dispatcher.isScoutDead()) {
        global.dispatcher.setScout(global.dispatcher.getAliveRobot());
    }

    // Тут назначался диверсант в зависимости от количества оставшихся Prospector Point-ов
    // В серебре был отключен
    /* if (prospectorPoints.length <= 7 && prospectorPoints.length >= 5) {
        global.dispatcher.designateMiner();
    } */

    for (let i = 0; i < 5; i += 1) {
        console.log(`${myRobots[i].getCommand()} ${roleMap[myRobots[i].role]}`);
    }
}
