// photoHandler.js
import i18n from 'i18n';
//import faceapi from '@vladmandic/face-api'; //For deploy
import faceapi from 'face-api.js';
import canvas from 'canvas';
import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fetch from 'node-fetch';
import AWS from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { BOT_NAMES, URLS } from './constants.js';

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
        // const processingMessage = await bot.sendAnimation(chatId, 'https://dating-storage.s3.aeza.cloud/gif/bean-mr.gif', {
        //     caption: i18n.__('photo_checking_message'),
        //     reply_markup: {
        //         remove_keyboard: true,
        //     },
        //     protect_content: true,
        //     });
        const processingMessage = await bot.sendMessage(chatId, i18n.__('photo_checking_message'), {
            reply_markup: {
                remove_keyboard: true,
            },
            protect_content: true,
        });        

        // Получение информации о фотографии
        const photo = msg.photo[msg.photo.length - 1];
        const fileId = photo.file_id;

        // Получение URL фотографии
        const file = await bot.getFile(fileId);
        const photoUrl = `https://api.telegram.org/file/bot${process.env.bot_token}/${file.file_path}`;
        const response = await fetch(photoUrl);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Сохранение фотографии в S3
        const photoFilename = `${userId}_${Date.now()}.jpg`;
        const originalPhotoPath = await uploadPhotoToS3(buffer, photoFilename);

        // Загрузка и Распознавание лиц на изображении
        const img = await canvas.loadImage(photoUrl);
        const detections = await faceapi.detectAllFaces(img, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.2 })).withFaceLandmarks().withFaceDescriptors();

        if (detections.length === 0) {
            // Если на фото нет лица
            const rejectionMessage = await bot.sendMessage(chatId, i18n.__('photo_rejected_message'));
            // Перемещение фотографии в папку /rejected
            const rejectedPhotoPath = await movePhotoToRejected(buffer, photoFilename);

            // Увеличение счетчика отклоненных фотографий
            let userPhoto = await UserPhoto.findOne({ user_id: existingUser._id });
            if (!userPhoto) {
                userPhoto = new UserPhoto({ user_id: existingUser._id, telegramId: userId, photos: [], rejectCount: 0 });
            }
            userPhoto.rejectCount++;
            await userPhoto.save();

            // Если количество отклоненных фотографий достигло 10, вывести сообщение пользователю
            if (userPhoto.rejectCount === 10) {
                await User.findOneAndUpdate({ telegramId: userId }, { $set: { 
                    globalUserState: 'blocked', 
                    blockReason: 'face_not_detected', 
                    isBlocked: true, 
                    blockDetails: {blockedAt: Date.now()} }
                });
                await Profile.findOneAndUpdate({ telegramId: userId }, { isActive: true });
                await bot.sendMessage(chatId, `${i18n.__('messages.photo_rejected_multiple_times')} @${BOT_NAMES.SUPPORT}`, {reply_markup: {remove_keyboard: true}});
                currentUserState.delete(userId);
                return;
            }

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
                userPhoto = new UserPhoto({ user_id: existingUser._id, telegramId: userId, photos: [] });
            }
            // Генерация и загрузка размытой версии фото
            const blurredBuffer = await blurImage(buffer);
            const blurredPhotoFilename = photoFilename.replace(/\.jpg$/, '_b.jpg');
            const blurredPhotoPath = await uploadPhotoToS3(blurredBuffer, blurredPhotoFilename);

            // Добавление фотографии в массив
            userPhoto.photos.push({
                filename: photoFilename,
                path: originalPhotoPath,
                blurredPath: blurredPhotoPath,
                size: buffer.length,
                uploadDate: Date.now(),
                verifiedPhoto: detections.length > 0, // true если фотография прошла проверку
            });
            await userPhoto.save();

            // Обновление свойства profilePhoto в коллекции profiles
            const lastPhotoId = userPhoto.photos[userPhoto.photos.length - 1]._id;
            const updatedProfile = await Profile.findOneAndUpdate(
                { user_id: existingUser._id },
                { profilePhoto: {
                    photo_id: lastPhotoId,
                    photoPath: originalPhotoPath,
                    photoBlurredPath: blurredPhotoPath,
                    uploadDate: Date.now(),
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
                        const agreementLink = URLS.AGREEMENT; // Ссылка на соглашение
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
                        const genderText = updatedProfile.gender === 'male' ? i18n.__('select_male') : i18n.__('select_female');
                        await bot.sendPhoto(chatId, updatedProfile.profilePhoto.photoPath, {
                            caption: `${updatedProfile.profileName}, ${updatedProfile.age}\n 🌍${updatedProfile.location.locality}, ${updatedProfile.location.country}\n${genderText}\n${aboutMeText}`,
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
async function uploadPhotoToS3(buffer, filename) {
    const s3Key = `photos/${filename}`;
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
        return `${URLS.S3}${s3Key}`;
    } catch (error) {
        console.error('Error uploading photo to S3:', error);
        throw new Error('Error uploading photo to S3');
    }
}

// Функция для размытия фото
async function blurImage(buffer) {
    try {
        const imageBuffer = await sharp(buffer)
            .resize(300) // Размер, на который вы хотите изменить изображение
            .blur(30) // Значение размытия
            .toBuffer();

        return imageBuffer;
    } catch (error) {
        console.error('Error blurring image:', error);
        return null;
    }
}

// Функция для перемещения фотографии в папку /rejected на сервер S3
async function movePhotoToRejected(buffer, filename) {
    const s3Key = `photos/rejected/${filename}`;
    const s3Params = {
        Bucket: 'dating-storage',
        Key: s3Key,
        Body: buffer,
        ContentType: 'image/jpeg',
        ACL: 'public-read', // Настройте ACL по вашим требованиям
    };

    try {
        await s3.upload(s3Params).promise();
        return `${URLS.S3}${s3Key}`;
    } catch (error) {
        console.error('Error moving photo to /rejected folder on S3:', error);
        throw new Error('Error moving photo to /rejected folder on S3');
    }
}