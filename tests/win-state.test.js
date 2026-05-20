const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function loadGame() {
  const elements = {};
  const context = {
    console,
    Math,
    Date,
    performance: { now: () => 0 },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    localStorage: {
      getItem: () => null,
      setItem: () => {},
    },
    window: {
      __snakeTestEnabled: true,
      devicePixelRatio: 1,
      addEventListener: () => {},
      matchMedia: () => ({ addEventListener: () => {}, removeEventListener: () => {} }),
    },
    document: {
      documentElement: {},
      fullscreenElement: null,
      exitFullscreen: () => ({ catch: () => {} }),
      addEventListener: () => {},
      querySelector: (selector) => elements[selector] || null,
      getElementById: (id) => elements[`#${id}`] || null,
    },
  };

  function makeElement() {
    return {
      style: {},
      classList: { toggle: () => {} },
      textContent: '',
      innerHTML: '',
      querySelector: () => makeElement(),
      getContext: () => ({
        setTransform: () => {},
        clearRect: () => {},
        save: () => {},
        restore: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        stroke: () => {},
        fill: () => {},
        arc: () => {},
        closePath: () => {},
        quadraticCurveTo: () => {},
        createRadialGradient: () => ({ addColorStop: () => {} }),
      }),
    };
  }

  elements['#game'] = makeElement();
  elements['#menu'] = makeElement();
  elements['#hud'] = makeElement();
  elements['#playBtn'] = makeElement();

  context.window.window = context.window;
  context.window.document = context.document;
  Object.assign(context.window, context);

  vm.createContext(context.window);
  vm.runInContext(fs.readFileSync('script.js', 'utf8'), context.window);
  return context.window;
}

const game = loadGame();
assert(game.__snakeTest, 'script should expose test helpers');

const fullOccupied = new Set();
for (let y = 0; y < 2; y += 1) {
  for (let x = 0; x < 2; x += 1) {
    fullOccupied.add(`${x},${y}`);
  }
}

assert.strictEqual(
  game.__snakeTest.findFreeCell(2, fullOccupied, () => 0),
  null,
  'findFreeCell should return null when the board is full'
);

const almostFull = new Set(['0,0', '1,0', '0,1']);
assert.strictEqual(
  JSON.stringify(game.__snakeTest.findFreeCell(2, almostFull, () => 0)),
  JSON.stringify({ x: 1, y: 1 }),
  'findFreeCell should return the only free cell'
);

const tailMoveState = {
  snake: [
    { x: 2, y: 1 },
    { x: 2, y: 2 },
    { x: 1, y: 2 },
    { x: 1, y: 1 },
  ],
  occupied: new Set(['2,1', '2,2', '1,2', '1,1']),
};

game.__snakeTest.moveWithoutEating(tailMoveState, 1, 1);
assert(
  tailMoveState.occupied.has('1,1'),
  'occupied should still contain the head when moving into the old tail cell'
);
assert.strictEqual(
  JSON.stringify(tailMoveState.snake[0]),
  JSON.stringify({ x: 1, y: 1 }),
  'snake head should move into the old tail cell'
);
assert.strictEqual(
  tailMoveState.snake.length,
  4,
  'moving without eating should keep the snake length unchanged'
);
assert.notStrictEqual(
  JSON.stringify(tailMoveState.snake[0]),
  JSON.stringify(tailMoveState.snake[1]),
  'moving without eating should not duplicate the head segment'
);

console.log('win-state tests passed');
