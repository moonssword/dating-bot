// photoHandler.js
import i18n from 'i18n';
import faceapi from 'face-api.js';
import canvas from 'canvas';
import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fetch from 'node-fetch';
import fs from 'fs';
import { join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

i18n.configure({
  locales: ['en', 'ru'], // Доступные языки
  directory: `${__dirname}/locales`, // Путь к файлам перевода
  defaultLocale: 'ru', // Язык по умолчанию
  objectNotation: true, // Использование объектной нотации для строк
});

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
export async function handlePhoto (bot, currentUserState, i18n, msg, User, UserPhoto, Profile) {
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
            }, 3000);
            console.error('Invalid message format. Missing or empty photo property.');
            return;
        }
        // Получение информации о фотографии
        const photo = msg.photo[msg.photo.length - 1];
        const fileId = photo.file_id;
        console.log('Фото', msg.photo);
        // Получение пользователя из базы данных по telegramId
        const user = await User.findOne({ telegramId: userId });

        // Проверка и создание папки /uploads/userphotos/'userId', если необходимо
        const userPhotosDir = join(__dirname, 'uploads', 'userphotos', user._id.toString());
        if (!fs.existsSync(userPhotosDir)){
            fs.mkdirSync(userPhotosDir, { recursive: true });
        }

        // Получение URL фотографии
        const file = await bot.getFile(fileId);
        const photoUrl = `https://api.telegram.org/file/bot${process.env.bot_token}/${file.file_path}`;
        console.log('URL фотографии', photoUrl);

        // Сохранение фотографии в папку
        const response = await fetch(photoUrl);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const filePath = join(userPhotosDir, `${fileId}.jpg`);
        fs.writeFileSync(filePath, buffer);

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

            // Удаление сообщения о том, что фотография отклонена через 3 секунды
            setTimeout(async () => {
                try {
                    await bot.deleteMessage(chatId, rejectionMessage.message_id);
                } catch (error) {
                    console.error('Error:', error);
                }
            }, 3000);
            return;
        }

        // Если на фото есть лицо
        const agreementLink = 'https://telegra.ph/Afreement-01-11'; // Ссылка на соглашение

        // Удаление сообщения photo_checking_message
        if (processingMessage.message_id) {
            await bot.deleteMessage(chatId, processingMessage.message_id);
        }

        // Вывод сообщения photo_verified_message на 1 секунды
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
            currentUserState.set(userId, 'confirm_agreement');
        }, 1000); // Ожидание 3 секунды перед выводом confirm_agreement_button

        // Создание или обновление записи в коллекции usersPhotos
        let userPhoto = await UserPhoto.findOne({ userId: user._id });
        if (!userPhoto) {
            userPhoto = new UserPhoto({ userId: user._id, photos: [] });
        }

        // Добавление фотографии в массив
        userPhoto.photos.push({
        filename: `${fileId}.jpg`,
        path: filePath,
        size: buffer.length,
        uploadDate: new Date(),
        verifiedPhoto: detections.length > 0, // true если фотография прошла проверку
        });

        // Сохранение или обновление данных в коллекции usersPhotos
        await userPhoto.save();

        // Обновление свойства profilePhoto в коллекции profiles
        const lastPhotoId = userPhoto.photos[userPhoto.photos.length - 1]._id;
        await Profile.findOneAndUpdate(
            { userId: user._id },
            { profilePhoto: {
                photoId: lastPhotoId,
                photoPath: filePath,
                uploadDate: new Date(),
                },
            },
            { new: true }
        );
        };

export default { handlePhoto };