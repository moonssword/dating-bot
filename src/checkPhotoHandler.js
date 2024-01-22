// photoHandler.js
import i18n from 'i18n';
import faceapi from 'face-api.js';
import canvas from 'canvas';
import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fetch from 'node-fetch';
import AWS from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';

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

const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    endpoint: 's3.aeza.cloud',
    s3ForcePathStyle: true,
  });

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
        const existingUser = await User.findOne({ telegramId: userId });
        console.log(msg);
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

        // Уведомление пользователя о том, что фотография обрабатывается
        const processingMessage = await bot.sendAnimation(chatId, 'https://dating-storage.s3.aeza.cloud/gif/bean-mr.gif', {
            caption: i18n.__('photo_checking_message'),
            reply_markup: {
                remove_keyboard: true,
            },
            protect_content: true,
            });

        // Получение информации о фотографии
        const photo = msg.photo[msg.photo.length - 1];
        const fileId = photo.file_id;
        console.log('Фото', msg.photo);

        // Получение URL фотографии
        const file = await bot.getFile(fileId);
        const photoUrl = `https://api.telegram.org/file/bot${process.env.bot_token}/${file.file_path}`;
        const response = await fetch(photoUrl);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Сохранение фотографии в S3
        const { filePath, uniquePhotoId } = await uploadPhotoToS3(buffer);

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
                    await bot.sendMessage(chatId, i18n.__('request_photo_message_text'), {
                        reply_markup: {
                          keyboard: i18n.__('back_button'),
                          resize_keyboard: true
                        }});
                } catch (error) {
                    console.error('Error:', error);
                }
            }, 3000);
            return;
        } else {
            // Создание или обновление записи в коллекции usersPhotos
            let userPhoto = await UserPhoto.findOne({ user_id: existingUser._id });
            if (!userPhoto) {
                userPhoto = new UserPhoto({ user_id: existingUser._id, photos: [] });
            }

            // Добавление фотографии в массив
            userPhoto.photos.push({
                filename: `${uniquePhotoId}.jpg`,
                path: filePath,
                size: buffer.length,
                uploadDate: new Date(),
                verifiedPhoto: detections.length > 0, // true если фотография прошла проверку
            });
            await userPhoto.save();

            // Обновление свойства profilePhoto в коллекции profiles
            const lastPhotoId = userPhoto.photos[userPhoto.photos.length - 1]._id;
            const updatedProfile = await Profile.findOneAndUpdate(
                { user_id: existingUser._id },
                { profilePhoto: {
                    photoId: lastPhotoId,
                    photoPath: filePath,
                    uploadDate: new Date(),
                    },
                },
                { new: true }
            );
            console.log('User profilePhoto updated', updatedProfile );

            // Если на фото есть лицо
            // Удаление сообщения photo_checking_message
            if (processingMessage.message_id) {
                await bot.deleteMessage(chatId, processingMessage.message_id);
            }
            // Вывод сообщения photo_verified_message на 2 секунды
            const verifiedMessage = await bot.sendMessage(chatId, i18n.__('photo_verified_message'));
            if (existingUser.globalUserState === 'registration_process') {
                setTimeout(async () => {
                    // Удаление сообщения photo_verified_message
                    try {
                        const agreementLink = 'https://telegra.ph/Afreement-01-11'; // Ссылка на соглашение
                        await bot.deleteMessage(chatId, verifiedMessage.message_id);
                        await bot.sendMessage(chatId, i18n.__('confirm_agreement_message'), {
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: i18n.__('confirm_agreement_link'), url: agreementLink }],
                                    [{ text: i18n.__('confirm_agreement_button'), callback_data: 'confirm_agreement_button' }],
                                ],
                            },
                        });
                    } catch (error) {
                        console.error('Error:', error);
                    }
                }, 2000);
                currentUserState.set(userId, 'confirm_agreement');

            } else if (existingUser.globalUserState === 'active') {
                
                setTimeout(async () => {
                    // Удаление сообщения photo_verified_message
                    try {
                        await bot.deleteMessage(chatId, verifiedMessage.message_id);
                        currentUserState.set(userId, 'my_profile');
                        let aboutMeText = updatedProfile.aboutMe ? `<blockquote><i>${updatedProfile.aboutMe}</i></blockquote>` : '';
                        await bot.sendPhoto(chatId, updatedProfile.profilePhoto.photoPath, {
                            caption: `${updatedProfile.profileName}, ${updatedProfile.age}\n 🌍${updatedProfile.location.locality}, ${updatedProfile.location.country}\n${i18n.__('myprofile_gender_message')} ${updatedProfile.gender}\n\n${aboutMeText}`,
                            reply_markup: {
                              keyboard: i18n.__('myprofile_buttons'),
                              resize_keyboard: true
                            },
                            parse_mode: 'HTML',
                            protect_content: true,
                          });
                    } catch (error) {
                        console.error('Error:', error);
                    }
                }, 3000);
            }
    }
};

export default { handlePhoto };

// Функция для загрузки фотографии на сервер S3
async function uploadPhotoToS3(buffer) {
    const uniquePhotoId = uuidv4();
    const s3Key = `photos/${uniquePhotoId}.jpg`;
    const s3Params = {
        Bucket: 'dating-storage',
        Key: s3Key,
        Body: buffer,
        ContentType: 'image/jpeg',
        ACL: 'public-read', // Настройте ACL по вашим требованиям
    };

    try {
        await s3.upload(s3Params).promise();
        console.log('Photo successfully uploaded to S3');
        return { filePath: `https://dating-storage.s3.aeza.cloud/${s3Key}`, uniquePhotoId };
    } catch (error) {
        console.error('Error uploading photo to S3:', error);
        throw new Error('Error uploading photo to S3');
    }
}