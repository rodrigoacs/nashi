import fs from 'fs'
import path from 'path'
import ffmpeg from 'fluent-ffmpeg'
import readline from 'readline'

const inputVideo = 'video_001.mp4'
const subtitleFilePath = path.join(process.cwd(), inputVideo.replace(path.extname(inputVideo), '.srt'))

if (!fs.existsSync(subtitleFilePath)) {
  console.error(`Arquivo de legenda não encontrado: ${subtitleFilePath}`)
  process.exit(1)
}

function cleanupTempFiles() {
  fs.readdirSync(process.cwd())
    .filter(file => file.startsWith('selected_subtitles_group_'))
    .forEach(file => fs.unlinkSync(file))
}

function timestampToSeconds(timestamp) {
  const [hours, minutes, rest] = timestamp.split(':')
  const [seconds, millis] = rest.split(',')
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(millis) / 1000
}

function secondsToTimestamp(seconds) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  const millis = Math.floor((seconds - Math.floor(seconds)) * 1000)
  const pad = (num, size) => {
    let s = String(num)
    while (s.length < size) s = '0' + s
    return s
  }
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secs, 2)},${pad(millis, 3)}`
}

function parseSRT(content) {
  const entries = content.split(/\r?\n\r?\n/)
  const subtitles = []
  for (const entry of entries) {
    const lines = entry.split(/\r?\n/)
    if (lines.length >= 2) {
      const index = parseInt(lines[0].trim(), 10)
      const timeLine = lines[1].trim()
      const [startTime, endTime] = timeLine.split(' --> ').map(s => s.trim())
      const text = lines.slice(2).join(' ').trim()
      subtitles.push({
        index,
        start: startTime,
        end: endTime,
        startSeconds: timestampToSeconds(startTime),
        endSeconds: timestampToSeconds(endTime),
        text
      })
    }
  }
  return subtitles
}

const srtContent = fs.readFileSync(subtitleFilePath, 'utf8')
const subtitles = parseSRT(srtContent)

/**
 * Gera um clipe para um intervalo de legendas definido pelos índices startIdx e endIdx.
 * - Rebaseia os tempos dos blocos selecionados para iniciar em 0.
 * - Renumera as legendas e gera um novo arquivo SRT.
 * - Extrai o clipe do vídeo com os filtros aplicados.
 *
 * @param {number} groupIndex - Índice do grupo (usado para nomear arquivos).
 * @param {number} startIdx - Índice inicial do intervalo.
 * @param {number} endIdx - Índice final do intervalo.
 * @returns {Promise} - Promise que é resolvida quando o clipe é gerado.
 */
function generateClipForInterval(groupIndex, startIdx, endIdx) {
  return new Promise((resolve, reject) => {
    const groupStart = Math.min(startIdx, endIdx)
    const groupEnd = Math.max(startIdx, endIdx)

    const selectedSubtitles = subtitles.filter(
      sub => sub.index >= groupStart && sub.index <= groupEnd
    )

    if (selectedSubtitles.length === 0) {
      console.error(`Nenhuma legenda encontrada para o intervalo: ${groupStart} a ${groupEnd}`)
      return reject(new Error("Nenhuma legenda encontrada para o intervalo"))
    }

    const clipStartSeconds = Math.min(...selectedSubtitles.map(sub => sub.startSeconds))
    const clipEndSeconds = Math.max(...selectedSubtitles.map(sub => sub.endSeconds))
    const clipDuration = clipEndSeconds - clipStartSeconds

    console.log(`\n[Grupo ${groupIndex + 1}] Intervalo: ${groupStart} a ${groupEnd}`)
    console.log(`[Grupo ${groupIndex + 1}] Clip: início em ${clipStartSeconds.toFixed(3)}s, duração de ${clipDuration.toFixed(3)}s.`)

    const adjustedSubtitles = selectedSubtitles
      .sort((a, b) => a.startSeconds - b.startSeconds)
      .map((sub, idx) => {
        const newStart = sub.startSeconds - clipStartSeconds
        const newEnd = sub.endSeconds - clipStartSeconds
        return {
          index: idx + 1,
          start: secondsToTimestamp(newStart),
          end: secondsToTimestamp(newEnd),
          text: sub.text
        }
      })

    const newSrtContent = adjustedSubtitles
      .map(sub => `${sub.index}\n${sub.start} --> ${sub.end}\n${sub.text}`)
      .join('\n\n')

    const newSrtPath = path.join(process.cwd(), `selected_subtitles_group_${groupIndex + 1}.srt`)
    fs.writeFileSync(newSrtPath, newSrtContent, 'utf8')
    console.log(`[Grupo ${groupIndex + 1}] Arquivo SRT gerado: ${newSrtPath}`)

    const outputFileName = `./out/vertical_clip_group_${groupIndex + 1}.mp4`

    ffmpeg(inputVideo)
      .setStartTime(clipStartSeconds)
      .duration(clipDuration)
      .videoFilters([
        { filter: 'scale', options: '-1:1920' },
        { filter: 'crop', options: '1080:1920:(in_w-1080)/2:0' },
        {
          filter: 'subtitles',
          options: `${newSrtPath}:force_style='FontName=DejaVu Sans Bold,FontSize=12,PrimaryColour=&HFFFFFF&,OutlineColour=&H000000&,Outline=2,Shadow=1,MarginV=10,Alignment=6'`
        }
      ])
      .outputOptions(['-movflags', 'faststart'])
      .on('end', () => {
        console.log(`[Grupo ${groupIndex + 1}] Clip gerado com sucesso: ${outputFileName}`)
        resolve()
      })
      .on('error', (err) => {
        console.error(`[Grupo ${groupIndex + 1}] Erro ao gerar clip: ${err.message}`)
        reject(err)
      })
      .save(outputFileName)

  })
}

function processIntervals(answer) {
  const groups = answer.includes(';')
    ? answer.split(';').map(g => g.trim())
    : [answer.trim()]

  const intervals = groups.map((group) => {
    const nums = group.split(',')
      .map(num => parseInt(num.trim(), 10))
      .filter(n => !isNaN(n))
    if (nums.length !== 2) {
      console.error(`O grupo "${group}" não contém exatamente dois números.`)
      process.exit(1)
    }
    return nums
  })

  Promise.all(
    intervals.map((nums, i) => generateClipForInterval(i, nums[0], nums[1]))
  )
    .then(() => {
      console.log("\nTodos os clipes foram gerados com sucesso!")
      cleanupTempFiles()
      process.exit(0)
    })
    .catch((err) => {
      console.error("Erro na geração de algum clipe:", err)
      cleanupTempFiles()
      process.exit(1)
    })
}

if (process.argv[2]) {
  processIntervals(process.argv[2])
} else {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })
  rl.question("Entre com os intervalos (ex.: '7,9' ou '7,9; 10,15; 20,25'): ", (answer) => {
    processIntervals(answer)
    rl.close()
  })
}
