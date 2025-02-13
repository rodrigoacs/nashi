import { exec } from 'child_process'
import path from 'path'

const inputVideo = 'video_001.mp4'
const subtitleFilePath = path.join(process.cwd(), inputVideo.replace(path.extname(inputVideo), '.srt'))

// --model: tiny, base, small, medium, large, turbo.
const whisperCommand = `whisper "${inputVideo}" --model large --output_format srt --device cuda`

console.log('Executando o Whisper com GPU para extrair as legendas...')

exec(whisperCommand, (error, stdout, stderr) => {
  if (error) {
    console.error(`Erro ao executar o Whisper: ${error.message}`)
    return
  }
  console.log('Whisper executado com sucesso.')
  console.log(`Legenda extraída com sucesso! Verifique o arquivo: ${subtitleFilePath}`)
})
