const { Telegraf } = require('telegraf');
const faceapi = require('face-api.js');
const canvas = require('canvas');
require('dotenv').config();

const bot = new Telegraf(process.env.bot_token);
faceapi.env.monkeyPatch({ Canvas: canvas.Canvas, Image: canvas.Image, ImageData: canvas.ImageData });

const MODEL_URL = './node_modules/face-api.js/weights';

// Загрузка модели для распознавания лиц
Promise.all([
    faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_URL),
    faceapi.nets.ssdMobilenetv1.loadFromDisk(MODEL_URL),
]).then(() => {
    console.log('Модели успешно загружены');
});

bot.start((ctx) => {
    ctx.reply('Добавьте свое фото или сделайте селфи, нажмите скрепку и прикрепите фотографию');
});

bot.on('photo', async (ctx) => {
    // Получение информации о фотографии
    const photo = ctx.message.photo[0];
    const fileId = photo.file_id;

    // Получение URL фотографии
    const file = await ctx.telegram.getFile(fileId);
    const photoUrl = `https://api.telegram.org/file/bot${process.env.bot_token}/${file.file_path}`;

    // Загрузка изображения
    const img = await canvas.loadImage(photoUrl);

    // Распознавание лиц на изображении
    const detections = await faceapi.detectAllFaces(img, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.2 })).withFaceLandmarks().withFaceDescriptors();

    // Проверка наличия лица
    let resultMessage = 'На фотографии нет лица.';
    if (detections.length > 0) {
        resultMessage = 'На фотографии есть лицо(а)!';
    }

    // Отправка результата проверки
    const sentMessage = await ctx.reply('Проверка завершена. Пожалуйста, подождите...');
    await ctx.telegram.editMessageText(ctx.chat.id, sentMessage.message_id, null, resultMessage);
});

bot.launch();
