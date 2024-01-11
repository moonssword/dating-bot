// photoHandler.js

const { Telegraf } = require('telegraf');
const faceapi = require('face-api.js');
const canvas = require('canvas');
require('dotenv').config();

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

// Определение функции обработки фотографии
const handlePhoto = async (bot, regStates, i18n, msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    if (!msg.photo || msg.photo.length === 0) {
        const savedMessage = await bot.sendMessage(chatId, i18n.__('wrong_photo_format'));
        setTimeout(async () => {
          try {
            await bot.deleteMessage(chatId, savedMessage.message_id);
          } catch (error) {
            console.error('Error:', error);
          }
        }, 2000);
        console.error('Invalid message format. Missing or empty photo property.');
        return;
    }
    // Получение информации о фотографии
    const photo = msg.photo[0];
    const fileId = photo.file_id;

    // Получение URL фотографии
    const file = await bot.getFile(fileId);
    const photoUrl = `https://api.telegram.org/file/bot${process.env.bot_token}/${file.file_path}`;

    // Уведомление пользователя о том, что фотография обрабатывается
    const processingMessage = await bot.sendMessage(chatId, i18n.__('photo_checking_message'), { parse_mode: 'Markdown' });

    // Загрузка изображения
    const img = await canvas.loadImage(photoUrl);

    // Распознавание лиц на изображении
    const detections = await faceapi.detectAllFaces(img, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.2 })).withFaceLandmarks().withFaceDescriptors();

    // Проверка наличия лица
    if (detections.length === 0) {
        // Если на фото нет лица
        const rejectionMessage = await bot.sendMessage(chatId, i18n.__('photo_rejected_message'));

        // Удаление сообщения о том, что фотография обрабатывается
        if (processingMessage.message_id) {
            await bot.deleteMessage(chatId, processingMessage.message_id);
        }

        // Удаление сообщения о том, что фотография отклонена через 2 секунды
        setTimeout(async () => {
            try {
                await bot.deleteMessage(chatId, rejectionMessage.message_id);
            } catch (error) {
                console.error('Error:', error);
            }
        }, 2000);
        return;
    }

    // Если на фото есть лицо
    const agreementLink = 'https://telegra.ph/Afreement-01-11'; // Ссылка на соглашение

    // Удаление сообщения photo_checking_message
    if (processingMessage.message_id) {
        await bot.deleteMessage(chatId, processingMessage.message_id);
    }

    // Вывод сообщения photo_verified_message на 2 секунды
    const verifiedMessage = await bot.sendMessage(chatId, i18n.__('photo_verified_message'));
    setTimeout(async () => {
        // Удаление сообщения photo_verified_message
        try {
            await bot.deleteMessage(chatId, verifiedMessage.message_id);
        } catch (error) {
            console.error('Error:', error);
        }

        // Вывод сообщения confirm_agreement_button
        bot.sendMessage(chatId, i18n.__('confirm_agreement_message'), {
            reply_markup: {
                inline_keyboard: [
                    [{ text: i18n.__('confirm_agreement_link'), url: agreementLink }],
                    [{ text: i18n.__('confirm_agreement_button'), callback_data: 'confirm_agreement_button' }],
                ],
            },
        });

        // Изменение статуса пользователя
        regStates.set(userId, 'confirm_agreement');
    }, 2000); // Ожидание 2 секунд перед выводом confirm_agreement_button
};

module.exports = { handlePhoto };