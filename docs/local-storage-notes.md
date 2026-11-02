# ملاحظة تقنية: التخزين المحلي في النسخة النهائية

مصدر التحقق: [Expo SQLite for SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/).

الدليل الرسمي يذكر دعم Android والويب ودوام قاعدة البيانات بعد إعادة تشغيل التطبيق، لكنه يصنف Web support في SDK 57 على أنه Alpha، ويطلب إعداد WASM ورؤوس COOP/COEP. لذلك تستخدم النسخة المحلية SQLite الأصلي في Android وIndexedDB/Dexie داخل Chromium المضمّن في تطبيق Electron على Windows، بدل تعريض نسخة Windows لتبعيات Web-SQLite التجريبية. كلاهما محلي ومستقل؛ لا توجد مزامنة.
