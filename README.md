Функционал
Этот проект представляет собой Telegram-бота с разнообразными функциями, включая регистрацию пользователей, работу с местоположением, обработку платежей и подписок, а также управление и проверку фотографий пользователей. Основные функции описаны ниже:


Основные функции
Регистрация и авторизация

- Бот приветствует пользователя и предлагает пройти регистрацию при первом запуске.
- Пользователь вводит данные для создания профиля, включая язык, пол, местоположение и дату рождения.

Профиль пользователя
- Пользователь может обновлять свой профиль, добавлять фотографии и управлять подписками.


Местоположение
Функции, связанные с определением и использованием местоположения пользователя:

- Получение местоположения: Получение данных о местоположении по координатам и вывод информации о городе, регионе и стране.
- Поиск города по названию: Поиск города по его названию и вывод списка возможных совпадений с кнопками для выбора.
- Расчет расстояния: Расчет расстояния между двумя точками (координатами) для отображения расстояния до других пользователей.


Обработка фотографий
Функции для загрузки, проверки и управления фотографиями пользователей:

- Загрузка фотографии: Пользователь загружает фотографию, которая затем сохраняется на сервере S3.
- Проверка фотографии: Использование библиотеки face-api.js для распознавания лиц на изображении. Если на фотографии не обнаружено лицо, она отклоняется.
- Размытие фотографии: Генерация размытой версии фотографии для отображения на профиле пользователя.
- Управление фотографиями: Сохранение информации о фотографиях в базе данных, включая количество отклоненных фотографий.