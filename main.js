const WHITE = 0
const BLACK = 1
const TRANSPARENT = 2

const FRAME_TYPE_MASK = 0b11000000
const RLE_INITIAL_COLOR_MASK = 0b00000011
const FRAME_TYPE_UNCOMPRESSED = 0
const FRAME_TYPE_RLE = 0b01000000
const FRAME_TYPE_RLE_DELTA = 0b10000000
const MULTIBYTE_FLAG = 0b10000000

const FRAME_TYPE_NAMES = ['UNCOMPRESSED', 'RLE', 'RLE_DELTA']

function runFromCLI() {
    let idx = 2
    let useDeltaCompression = true
    for (; idx < process.argv.length; idx++) {
        let arg = process.argv[idx]
        if (arg.startsWith('-')) {
            switch (arg) {
                case '-h':
                    usage()
                    process.exit(0)
                    break
                case '--no-delta':
                    useDeltaCompression = false
                    break
                default:
                    console.log(`Unknown option ${arg}`)
                    process.exit(1)
            }
        } else {
            break
        }
    }
    if (idx >= process.argv.length) {
        console.log('No input file specified')
        process.exit(1)
    }
    let input = process.argv[idx++]

    var fs = require('fs');
    let inputCode = fs.readFileSync(input, 'utf8')
    let code = compressAnimationFromCode(inputCode, useDeltaCompression)
    console.log(code)
}

function usage() {
    console.log('Usage: node main.js [options] <input file>')
    console.log('Options:')
    console.log('  -h  Show this help')
    console.log('  --no-delta  Disable delta compression')
}

var compress = function(){
    compressFromBrowser();
};

// Called from browser, read form input and put result in output
function compressFromBrowser() {
    var errorElement = document.getElementById('error')
    errorElement.classList.remove('show')

    try {
        let inputCode = document.getElementById('input').value
        let useDeltaCompression = true //document.getElementById('useDeltaCompression').checked
        const {code, animation, originalSize, compressedSize} = compressAnimationFromCode(inputCode, useDeltaCompression)
        let output = document.getElementById('output')
        output.value = code
        document.getElementById('stats').innerHTML = `${originalSize} -> ${compressedSize} bytes`
    } catch (e) {
        errorElement.innerHTML = e.message
        errorElement.classList.add('show')
    }
}

function copyToClipboard() {
    let text = document.getElementById('output').value
    navigator.clipboard.writeText(text)
    let button = document.getElementById('copy-button')
    const tooltip = bootstrap.Tooltip.getInstance('#copy-button')
    button.setAttribute('data-bs-original-title', 'Copied!')
    tooltip.update()
    tooltip.show()
    setTimeout(function () {
        tooltip.hide()
        button.setAttribute('data-bs-original-title', 'Copy to clipboard')
        tooltip.update()
    }, 3000)
}

function compressAnimationFromCode(code, useDeltaCompression) {
    let animation = parseAnimation(code)
    console.log(`Parsed animation with ${animation.frames.length} frames of size ${animation.width}x${animation.height}`)
    for (i = 0; i < animation.frames.length; i++) {
        animation.frames[i].printToConsole(i)
    }
    const originalSize = animation.frames.length * Math.ceil(animation.width / 8) * animation.height
    compressAnimation(animation, useDeltaCompression)
    let compressedData = animation.getCompressedAnimationData()
    console.log(`Compressed animation from ${originalSize} to ${compressedData.length} bytes`)
    verifyCompression(animation, compressedData)
    return {
        code: generateEmbeddingCode(animation, compressedData),
        animation: animation,
        originalSize: originalSize,
        compressedSize: compressedData.length
    }
}

function generateEmbeddingCode(animation, compressedData) {
    let code = `#include <Arduino.h>\n`
    code += `#include <Adafruit_SSD1306.h>\n`
    code += `#include <Animation.h>\n`
    code += `\n`
    code += `#define SCREEN_I2C_ADDR 0x3D // or 0x3C\n`
    code += `#define SCREEN_WIDTH 128     // OLED display width, in pixels\n`
    code += `#define SCREEN_HEIGHT 64     // OLED display height, in pixels\n`
    code += `#define OLED_RST_PIN -1      // Reset pin (-1 if not available)\n`
    code += `Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);\n`
    code += `\n`
    code += `// clang-format off\n`
    code += `const byte PROGMEM animationData[${compressedData.length}] = {${compressedData.join(',')}};\n`
    code += `// clang-format on\n`
    code += `\n`
    code += `Animation animation(animationData, &display, 0, 0);\n`
    code += `\n`
    code += `void setup() {\n`
    code += `  display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS);\n`
    code += `  display.clearDisplay();\n`
    code += `  animation.start();\n`
    code += `}\n`
    code += `\n`
    code += `void loop() {\n`
    code += `  animation.update();\n`
    code += `  if (animation.finished()) {\n`
    code += `    animation.start();\n`
    code += `  }\n`
    code += `}\n`

    return code
}

function verifyCompression(animation, compressedData) {
    // verify that compressed data only contains bytes (integer values between 0 and 255)
    for (let i = 0; i < compressedData.length; i++) {
        let value = compressedData[i]
        if (value < 0 || value > 255) {
            throw new Error(`Assertion failed, compressed data contains value ${value} at index ${i}`)
        }
        if (!Number.isInteger(value)) {
            throw new Error(`Assertion failed, compressed data contains non-integer value ${value} at index ${i}`)
        }
    }

    let lastFrame = null
    const frameCount = compressedData[0]
    const w = compressedData[1]
    const h = compressedData[2]
    assertEqual('frame count', animation.frames.length, frameCount)
    assertEqual('width', animation.width, w)
    assertEqual('height', animation.height, h)
    for (let i = 0; i < animation.frames.length; i++) {
        const dataIndex = readInt(compressedData, i * 2 + 3)
        let frame = decompressFrame(w, h, compressedData.slice(dataIndex), lastFrame)
        let expectedFrame = animation.frames[i]
        lastFrame = frame

        try {
            assertEqual("width", expectedFrame.width, frame.width)
            assertEqual("height", expectedFrame.height, frame.height)
            assertEqual("data size", expectedFrame.data.length, frame.data.length)
            for (let j = 0; j < frame.data.length; j++) {
                const x = j % frame.width
                const y = Math.floor(j / frame.width)
                assertEqual(`pixel ${x},${y}`, expectedFrame.data[j], frame.data[j])
            }
        } catch (e) {
            console.log(`Expected frame ${i}: ${e.message}`)
            expectedFrame.printToConsole()
            console.log(`Actual frame ${i}`)
            frame.printToConsole()
            throw e
        }
    }
}

function assertEqual(name, expected, actual) {
    if (expected !== actual) {
        throw new Error(`Assertion failed, ${name} expected ${expected} but was ${actual}`)
    }
}

function parseAnimation(code) {
    let w = parseInt(extract(/#define FRAME_WIDTH \((\d+)\)/, code))
    let h = parseInt(extract(/#define FRAME_HEIGHT \((\d+)\)/, code))
    if (w > 255 || h > 255) {
        throw new Error(`Frame size ${w}x${h} is too large, maximum is 255x255`)
    }
    let animation = new Annimation(w, h)

    let framesCode = extract(/const byte PROGMEM frames[[\]0-9 =]*({[^;]*);/, code)
    // convert to JSON and parse
    let framesJson = framesCode.replaceAll('{', '[').replaceAll('}', ']')
    let framesMatrix = JSON.parse(framesJson)
    for (let frameObject of framesMatrix) {
        let frame = parseFrame(w, h, frameObject)
        animation.addFrame(frame)
    }
    return animation
}

/*
 * Based on Adafruit_GFX::drawBitmap
 */
function parseFrame(w, h, bitmapData) {
    let data = []
    let byteWidth = Math.ceil(w / 8)
    let b = 0
    for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
            if (i & 7) {
                b <<= 1
            } else {
                b = bitmapData[j * byteWidth + Math.floor(i / 8)]
            }
            if (b & 0x80) {
                data.push(BLACK)
            } else {
                data.push(WHITE)
            }
        }
    }
    return new Frame(bitmapData, w, h, data)
}

function extract(regex, code) {
    let match = regex.exec(code)
    if (!match) {
        console.log(`No match for ${regex}`)
        throw new Error(`No match for ${regex}`)
    }
    return match[1]
}

function compressAnimation(animation, useDeltaCompression) {
    let lastFrame = null
    for (let frame of animation.frames) {
        compressFrame(frame, useDeltaCompression ? lastFrame : null)
        lastFrame = frame
    }
}

function compressFrame(frame, lastFrame) {
    let compressed = compressFrameRLE(frame, null)
    if (lastFrame) {
        let compressedDelta = compressFrameRLE(frame, lastFrame)
        if (compressedDelta.length < compressed.length) {
            compressed = compressedDelta
        }
    }
    if (compressed.length > frame.bitmapData.length) {
        compressed = [FRAME_TYPE_UNCOMPRESSED, ...frame.bitmapData]
    }
    frame.compressedData = compressed
    console.log(`Compressed frame from ${frame.bitmapData.length} to ${compressed.length} bytes (${FRAME_TYPE_NAMES[compressed[0] >> 6]})`)
}

function compressFrameRLE(frame, lastFrame) {
    const runLengths = computeRunLenghts(lastFrame, frame);

    /*
     We will never have two subsequent runs for the same color. Therefore, we only need the color delta with previous run.
     When delta compression is used, the color is encoded as delta 0, 1, followed by 6-bit runlength
     When no delta compression is used, the color delta is always 1, so we only need to store the 7-bit runlength
     When the runlength is too long, the first bit is set to indicate another byte follows. The next byte(s) contain
     also 7-bit runlengths and a flag indicating that another byte follows.
     */
    let useDeltaCompression = lastFrame != null
    const maxShortRunlength = useDeltaCompression ? 0b00111111 : 0b01111111
    const numberOfColors = useDeltaCompression ? 3 : 2
    const initialColor = (runLengths[0][0] + numberOfColors - 1) % numberOfColors
    const frameType = useDeltaCompression ? FRAME_TYPE_RLE_DELTA : FRAME_TYPE_RLE
    let compressed = [frameType | initialColor]
    let lastColor = initialColor
    for (let [color, runLength] of runLengths) {
        if (color === lastColor) {
            throw new Error(`Assertion failed, color ${color} is same as last color ${lastColor}`)
        }
        const colorDelta = (color - lastColor + numberOfColors) % numberOfColors - 1
        const colorBits = useDeltaCompression ? colorDelta << 6 : 0
        if (colorBits > 255) {
            throw new Error(`Assertion failed, color bits ${colorBits} is too large`)
        }
        lastColor = color
        if (runLength > maxShortRunlength) {
            let rl = runLength
            let bytes = []
            while (rl > maxShortRunlength) {
                let rlByte = rl & 0b01111111
                rl >>= 7
                bytes.push(MULTIBYTE_FLAG | rlByte)
            }
            bytes.push(colorBits | MULTIBYTE_FLAG | rl)
            bytes[0] &= 0b01111111
            bytes.reverse()
            compressed.push(...bytes)
        } else {
            compressed.push(colorBits | runLength)
        }
    }
    return compressed
}

/**
 * Returns an array of runlengths, each runlength is a tuple [color, runLength]
 * @param lastFrame optional lastFrame, when given, a delta compression is used
 * @param frame the frame to compress
 */
function computeRunLenghts(lastFrame, frame) {
    let useDeltaCompression = lastFrame != null
    let data = useDeltaCompression ? createDelta(frame.data, lastFrame.data) : frame.data
    let opaqueData = frame.data

    function nextRunlenght(data, idx) {
        let color = data[idx]
        let runLength = 1
        while (idx + runLength < data.length && data[idx + runLength] === color) {
            runLength++
        }
        return [color, runLength]
    }

    let runLengths = []
    let idx = 0
    while (idx < data.length) {
        let runLength = nextRunlenght(data, idx)
        let opaqueRunLength = nextRunlenght(opaqueData, idx)
        if (opaqueRunLength[1] > runLength[1]) {
            // use opaque run
            runLength = opaqueRunLength
        }
        runLengths.push(runLength)
        idx += runLength[1]
    }

    return runLengths
}

function decompressFrame(w, h, compressedData, lastFrame) {
    const type = compressedData[0]
    if ((type & FRAME_TYPE_MASK) === FRAME_TYPE_UNCOMPRESSED) {
        const bitmapData = compressedData.slice(1)
        return parseFrame(w, h, bitmapData)
    }
    let useDeltaCompression = (type & FRAME_TYPE_MASK) === FRAME_TYPE_RLE_DELTA
    let data = []
    let idx = 1
    let lastColor = type & RLE_INITIAL_COLOR_MASK
    let startPixel = 0
    while (startPixel < w * h) {
        const value = compressedData[idx]
        let color = useDeltaCompression ? (lastColor + ((value >> 6) & 0x01) + 1) % 3 : 1 - lastColor
        if (color === lastColor) {
            throw new Error(`Assertion failed, color ${color} is same as last color ${lastColor}`)
        }
        lastColor = color
        let runLength = useDeltaCompression ? value & 0b00111111 : value & 0b01111111
        if (value & MULTIBYTE_FLAG) {
            idx++
            let rlByte = compressedData[idx]
            runLength = (runLength << 7) | (rlByte & 0b01111111)
            while (rlByte & MULTIBYTE_FLAG) {
                idx++
                rlByte = compressedData[idx]
                runLength = (runLength << 7) | (rlByte & 0b01111111)
            }
        }
        startPixel += runLength
        for (let i = 0; i < runLength; i++) {
            if (color === TRANSPARENT) {
                if (!compressedData || !lastFrame) {
                    throw new Error('Assertion failed, transparent color without compression or last frame')
                }
                data.push(lastFrame.data[data.length])
            } else {
                data.push(color)
            }
        }
        idx++
    }
    return new Frame(null, w, h, data)
}

// Each pixel that is equal in both frames is encoded as TRANSPARENT
function createDelta(data, lastData) {
    let delta = []
    for (let i = 0; i < data.length; i++) {
        delta.push(data[i] === lastData[i] ? TRANSPARENT : data[i])
    }
    return delta
}

class Annimation {
    constructor(w, h) {
        this.frames = []
        this.width = w
        this.height = h
    }

    addFrame(frame) {
        this.frames.push(frame)
    }

    /*
     Compressed data format:
     [frameCount, width, height, idx0, idx1, idx2, ... idxN+1, frame0, frame1, frame2, ... frameN]
     where the indices point to the start of each frame in the array
     */
    getCompressedAnimationData() {
        let data = [this.frames.length, this.width, this.height]
        let index = data.length + this.frames.length * 2
        for (let frame of this.frames) {
            pushInt(data, index)
            index += frame.compressedData.length
        }
        for (let frame of this.frames) {
            data.push(...frame.compressedData)
        }
        return data
    }
}

class Frame {
    constructor(bitmapData, w, h, data) {
        this.bitmapData = bitmapData
        // linear array of pixels, each pixel is 0 (white) or 1 (black)
        this.data = data
        this.width = w
        this.height = h
        this.compressedData = null
    }

    printToConsole(nr) {
        console.log(`Frame ${nr}:`)
        for (let y = 0; y < this.height; y++) {
            let row = ''
            for (let x = 0; x < this.width; x++) {
                let pixel = this.data[y * this.width + x]
                switch (pixel) {
                    case WHITE:
                        row += '-'
                        break
                    case BLACK:
                        row += '#'
                        break
                    case TRANSPARENT:
                        row += '.'
                        break
                }
            }
            console.log(row)
        }
    }
}

function pushInt(array, value) {
    array.push(value & 0xff)
    array.push(value >> 8)
}

function readInt(array, idx) {
    return array[idx] | array[idx + 1] << 8
}

function initPage() {
    console.log('Initializing page')
}

if (typeof process == 'undefined') {
    console.log('Arduino Animation Compressor running from browser')
    window.onload = initPage
} else if (process.argv[1].endsWith('main.js')) {
    console.log('Arduino Animation Compressor running from console')
    runFromCLI()
} else {
    console.log('Arduino Animation Comressor loaded as library')
}
