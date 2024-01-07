var app = require('./main.js')
// import * as app from './main.js'

count = 0
failcount = 0

function runTests() {
    optimizeWithEscapesTest()
}

function optimizeWithEscapesTest() {
    // assertOptimizationOfOpaqueRuns([[0, 20], [1, 2], [0, 2], [1, 3]], [[0, 20], [-1, 7]])
    // assertOptimizationOfOpaqueRuns([[0, 20], [1, 1], [0, 2], [1, 3]], [[0, 19], [-1, 7]])
    // assertOptimizationOfOpaqueRuns([[1, 2], [0, 2], [1, 3]], [[-1, 7]])
    // assertOptimizationOfOpaqueRuns([[0, 20], [1, 2], [0, 2], [1, 3], [0, 20], [1, 2], [0, 2], [1, 3]], [[0, 20], [-1, 7], [0, 20], [-1, 7]])
    // assertOptimizationOfOpaqueRuns([[0, 20], [1, 2], [0, 2], [1, 2], [0, 8], [1, 3], [0, 2]], [[0, 18], [-1, 21]])
    // assertOptimizationOfOpaqueRuns([[0, 8], [1, 7], [0, 1], [1, 6]], [[0, 8], [1,7], [-1, 7]])

    assertOptimazationOfOpaqueRuns2([20, 2, 2, 3], "0-20,*-7")
    assertOptimazationOfOpaqueRuns2([20, 1, 2, 3], "0-19,*-7")
    assertOptimazationOfOpaqueRuns2([2, 2, 3], "*-7")
    assertOptimazationOfOpaqueRuns2([20, 2, 2, 3, 20, 2, 2, 3], "0-20,*-7,0-20,*-7")
    assertOptimazationOfOpaqueRuns2([20, 2, 2, 2, 8, 3, 2], "0-18,*-21")
    assertOptimazationOfOpaqueRuns2([8, 7, 1, 6], "0-8,1-7,0-1,1-6") // prefer RLE if it's the same length
}

function assertOptimazationOfOpaqueRuns2(runLengths, expectedString) {
    let opaqueData = []
    let currentColor = 0
    let runs = []
    for (let runLength of runLengths) {
        for (let i=0; i < runLength; i++) {
            opaqueData.push(currentColor)
        }
        runs.push([currentColor, runLength])
        currentColor = 1 - currentColor
    }
    let expected = []
    let expectedRuns = expectedString.split(",")
    for (let run of expectedRuns) {
        let [color, length] = run.split("-")
        color = color === "*" ? -1 : color
        expected.push([parseInt(color), parseInt(length)])
    }
    assertOptimizationOfOpaqueRuns(runs, expected, opaqueData)
}

function assertOptimizationOfOpaqueRuns(runs, expected, opaqueData) {
    count++
    let result = app.optimizeWithEscapes(runs, opaqueData)
    const expectedString = JSON.stringify(expected)
    const resultString = JSON.stringify(result)
    // if (result !== expected) {
    //     fail(`Expected ${expected} but got ${result}`)
    // }
    if (expectedString !== resultString) {
        fail(`Expected ${expectedString} but got ${resultString}`)
    }
}

runTests()

function fail(message) {
    console.log(`FAIL ${message}`)
    failcount++
}

if (failcount > 0) {
    console.log(`There were ${failcount} failing tests!`)
    process.exit(1)
}

console.log(`Succesfully ran ${count} tests`)
