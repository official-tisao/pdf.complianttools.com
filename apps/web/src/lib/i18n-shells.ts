/**
 * Messages for the shared page shells.
 *
 * Kept in its own module because it is the copy *every* tool route renders,
 * while `i18n.ts` holds the invoice-specific catalogue. Splitting them means a
 * wording change to shell chrome does not touch a 100-line invoice dictionary,
 * and — more importantly — a missing Arabic entry in shell copy is visible on
 * any page rather than buried in one surface's keys.
 *
 * The catalogue is merged into `translate()` in `i18n.ts`, so call sites use a
 * single function and a single `locale`; this module only owns data.
 */

/**
 * Translators: keep product and format names unchanged (PDF, DOCX, UBL, ISO);
 * preserve every `{value}` placeholder; keep labels short, because tool labels
 * sit in a narrow column and the `en-XA` pass pads them to catch overflow.
 */
export const shellArabic: Readonly<Record<string, string>> = {
  // Shell chrome shared by every tool page.
  'shell.eyebrow.default': 'أداة PDF',
  'shell.eyebrow.editSecurity': 'تحرير وأمان',
  'shell.action.export': 'تصدير PDF',
  'shell.action.merge': 'دمج الملفات',
  'shell.action.split': 'تقسيم PDF',
  'shell.action.compress': 'ضغط PDF',
  'shell.action.crop': 'قص الصفحات',
  'shell.action.rotate': 'تدوير الصفحات',
  'shell.action.extract': 'استخراج الصفحات',
  'shell.action.remove': 'حذف الصفحات',
  'shell.action.insert': 'إدراج الصفحات',
  'shell.action.resize': 'تغيير حجم الصفحة',
  'shell.action.nup': 'توزيع الصفحات',
  'shell.action.halve': 'تصفيح الصفحات',
  'shell.action.bates': 'إضافة ترقيم Bates',
  'shell.action.flatten': 'تسطيح PDF',
  'shell.action.repair': 'إصلاح PDF',
  'shell.action.optimize': 'تحسينه للويب',
  'shell.action.convert': 'تحويل',

  'shell.files.ready': 'ملف واحد جاهز محليًا.',
  'shell.files.readyPlural': '{value} ملفات جاهزة محليًا.',
  'shell.preview.empty': 'تظهر معاينات الصفحات هنا بعد اختيار ملف PDF.',
  'shell.preview.selected': 'الصفحة المحددة {value}',
  'shell.preview.pageAlt': 'معاينة الصفحة {value}',
  'shell.status.working': 'جارٍ العمل محليًا…',
  'shell.status.done': 'تم. لم تتغيّر ملفاتك الأصلية.',
  'shell.status.failed': 'تعذّر إتمام العملية.',
  'shell.pageCount': '{value} صفحة',

  // Capability boundaries — the honest "not offered, and why" copy on the four
  // routes whose engine operation does not exist. These say the reason, because
  // a disabled control without one reads as a broken product.
  'shell.unavailable.bookmarks':
    'هذه الأداة غير متاحة بعد. تُقرأ الإشارات المرجعية لملف PDF محليًا، لكن لا يوجد كاتب متاح بتصريح مفتوح لبنية الفهرس، فلا يمكن حفظها دون إعادة كتابة مستندك بالكامل. لا تُقرأ ملفاتك ولا تُرفع ولا تُعدَّل في هذه الصفحة.',
  'shell.unavailable.pdfa':
    'الفحص متاح، والتحويل غير متاح. يمكن إصدار تقرير مطابقة PDF/A محليًا بنتيجة صريح لكل فحص، لكن لا يوجد كاتب متاح بتصريح مفتوح ينشئ ملف PDF/A دون إعادة ترميز المستند بالكامل. لذلك لا تعرض هذه الصفحة زرًا ينتج ملف PDF عاديًا يحمل اسم PDF/A.',
  'shell.unavailable.rasterize':
    'هذه الأداة غير متاحة بعد. يتطلب تحويل الصفحات إلى صور محرك عرض محلي، وحزمة pdfium المرخَّصة لأساسيات الترخيص غير مضمّنة مع الموقع بعد. تفضّل الصفحة تذكر ذلك هنا بدلًا من زر يفشل بعد اختيار الملف. تحويل PDF إلى صور متاح.',

  // FeaturePage: create / QR / scan / pack / relay / batch / recipe / watcher.
  'feature.eyebrow': 'سير عمل محلي',
  'feature.template.label': 'القالب',
  'feature.template.blank': 'فارغ',
  'feature.template.grid': 'مربعات',
  'feature.template.lined': 'مسطر',
  'feature.template.dot': 'نقاط',
  'feature.action.create': 'إنشاء PDF',
  'feature.qr.label': 'نص أو رابط',
  'feature.qr.action': 'تصدير رمز QR إلى PDF',
  'feature.scan.label': 'صور المسح الضوئي',
  'feature.scan.drop': 'أفلت الصور هنا أو اختر ملفات',
  'feature.pack.drop': 'أفلت ملفات PDF هنا أو اختر ملفات',
  'feature.batch.drop': 'أفلت ملفات PDF هنا أو اختر ملفات',
  'feature.scan.action': 'تجميعها في PDF',
  'feature.pack.label': 'المستندات المراد حزمها',
  'feature.pack.action': 'إنشاء حزمة مستندات',
  'feature.webpage.label': 'رابط صفحة عامة',
  'feature.webpage.endpoint': 'عنوان Relay لديك',
  'feature.webpage.note':
    'التقاط صفحات الويب يعمل في وضع Relay الصريح فقط. أدوات PDF المحلية لا تحتاج هذا العنوان.',
  'feature.webpage.action': 'التقاط عبر Relay',
  'feature.batch.label': 'ملفات PDF المعالجة',
  'feature.batch.action': 'تشغيل دفعة محلية',
  'feature.batch.note':
    'التوازي والذاكرة محدودان، وتبقى الملفات الفاشلة قابلة لإعادة المحاولة فرديًا.',
  'feature.batch.download': 'تنزيل النتائج كملف مضغوط',
  'feature.batch.downloadPartial': 'تنزيل المكتمل حتى الآن',
  'feature.batch.retry': 'إعادة محاولة الملفات الفاشلة فقط',
  'feature.recipe.remove': 'إزالة',
  'feature.recipe.save': 'حفظ في هذا المتصفح',
  'feature.recipe.export': 'تصدير بيانات الوصفة',
  'feature.recipe.step': 'الخطوة',
  'feature.recipe.compress': 'ضغط',
  'feature.recipe.bates': 'ترقيم Bates',
  'feature.recipe.metadata': 'البيانات الوصفية',
  'feature.recipe.action': 'نسخ رابط وصفة بلا مستند',
  'feature.watch.start': 'اختر مجلدًا وابدأ المراقبة',
  'feature.watch.pause': 'إيقاف مؤقت',
  'feature.watch.resume': 'استئناف',
  'feature.watch.stop': 'إيقاف',
  'feature.watch.note': 'الحالة: {value}. لا تُقرأ أي مجلدات قبل منح الإذن.',
  'feature.watch.output': 'تُكتب النتائج في مجلد المعالجة داخل {value}.',
  'feature.noControls': 'لا توجد أدوات تحكم لهذه الأداة بعد. لم يُشغَّل أي شيء.',

  // ConversionTool chrome.
  'shell.trust.strong': 'محلي أولًا.',
  'shell.trust.body': 'لا يُرفع أي شيء في هذا المسار.',
  'shell.convert.done': 'اكتمل التحويل. بقي ملفك على جهازك.',
  'shell.convert.failed': 'تعذّر إتمام التحويل محليًا.',
  'shell.convert.busy': 'جارٍ التحويل…',
  'shell.convert.drop': 'أفلت ملفًا هنا أو اختر مدخلًا بصيغة {value}',
  'shell.convert.unavailableHeading': 'غير متاح في النسخة المحلية النظيفة',
  'shell.convert.unavailableHelp':
    'يبقى الملف الأصلي على جهازك. اختر مسار التصدير المقترح ثم أعد المحاولة.',

  // PhaseCTool: editor, annotation, forms, signature, request and redaction
  // controls, plus the action labels its operation switch renders.
  'phase.action.run': 'تشغيل محلي',
  'phase.action.generate': 'توليد محلي',
  'phase.download': 'تنزيل',
  'shell.title.locally': '{value} محليًا',
  'phase.caution.redact':
    'الإجراء الاحتياطي المحلي يحذف تدفق المحتوى بالكامل للصفحات المطابقة، ثم يتحقق من النص والبنية والبيانات الوصفية. راجع قبل المشاركة.',
  'phase.caution.readOnly':
    'هذا تقرير إثبات للقراءة فقط. تبقى الادعاءات غير المدعومة عن التشفير أو التحرير ظاهرة كعلاجات.',
  'feature.status.created': 'أُنشئ محليًا.',
  'feature.status.qr': 'وُلد رمز QR حتمي الإصدار {value}.',
  'feature.status.scan': 'جُمّع المسح محليًا؛ لا يُطلب إذن الكاميرا إلا بعد إجراء صريح.',
  'feature.status.pack': 'بُنيت حزمة المستندات محليًا مع جدول محتويات مُولَّد.',
  'feature.status.relay': 'اكتمل الالتقاط عبر Relay.',
  'feature.status.failed': 'تعذّر إتمام العملية.',
  'feature.status.files': 'رُصد ملف جديد: {value}',
  'feature.status.batch': 'اكتمل {value} من {total} ملفًا محليًا.',
  'feature.status.scanEmpty': 'التقط صفحة أو أضف ملفات صور أولًا.',
  'feature.status.scanAssembled': 'جُمّعت {value} صفحة محليًا. لم يُرفع شيء.',
  'feature.status.scanFailed': 'تعذّر تجميع المسح.',
  'feature.batch.governor':
    'خفّضت حدود الذاكرة التزامن إلى {value}؛ حجم العمل المتوقع {total} ميغابايت مقابل ميزانية {extra} ميغابايت.',
  'feature.status.batchRetryFailed': 'لا يزال {value} ملفًا يفشل بعد إعادة المحاولة.',
  'feature.status.batchRetryComplete': 'اكتملت كل الملفات بعد إعادة محاولة الإخفاقات.',
  'feature.status.batchDownload': 'نُزّل ملف مضغوط للملفات المكتملة وبيان بالباقي.',
  'feature.status.recipeExported': 'صُدّرت بيانات الوصفة؛ لا تحتوي بايتات المستند.',
  'feature.status.recipeSaved': 'حُفظ في هذا المتصفح وسيبقى عند عودتك.',
  'feature.status.recipeLoadFailed':
    'تعذرت قراءة رابط الوصفة. ابدأ وصفة جديدة أو انسخ رابطًا جديدًا.',
  'feature.batch.attempts': '{value} محاولات',
  'feature.watch.failed': '{value} فشل: {total}',
  'feature.status.recipe': 'نُسخ رابط المشاركة؛ وهو لا يحتوي بايتات المستند.',
  'feature.status.watch': 'مراقب المجلد يعمل. المعالجة محلية وبإذن صريح.',
  'phase.trust.body': 'لا يرفع هذا المسار بايتات المستند أو بيانات الاعتماد.',
  'phase.replace.find': 'النص الموجود لاستبداله',
  'phase.replace.findPlaceholder': 'مقطع نصي حرفي بسيط',
  'phase.replace.label': 'البديل',
  'phase.replace.placeholder': 'نص البديل',
  'phase.text.label': 'مربع النص الاحتياطي',
  'phase.redact.label': 'نص أو تعبير نمطي لإزالته',
  'phase.redact.placeholder': 'رقم هوية أو بريد أو تعبير نمطي',
  'phase.request.recipients': 'المستلمون',
  'phase.request.placeholder': 'one@example.com, two@example.com',
  'phase.request.message': 'الرسالة',
  // Deliberately labelled "signature text" rather than the generic "Text /
  // note" it replaced: a screen-reader user is told what the field is for.
  'phase.sign.label': 'نص التوقيع',
  'phase.sign.page': 'الصفحة',
  'phase.sign.pad': 'ارسم توقيعًا',
  'phase.sign.clear': 'مسح الرسم',
  'phase.sign.padHelp': 'ارسم بمؤشر، أو استخدم حقل النص أدناه عبر لوحة المفاتيح.',
  'phase.sign.upload': 'تحميل توقيع بصيغة PNG أو JPEG',
  'phase.signatureBackground.threshold': 'عتبة الخلفية',
  // PhaseCTool engine-result messages, one per operation.
  'phase.error.noFile': 'اختر ملفًا محليًا أولًا. لا يُرفع أي شيء.',
  'phase.error.image': 'اختر ملف PDF وصورة بصيغة PNG أو JPEG.',
  'phase.error.overlay': 'اختر ملف PDF أساسيًا وآخر للتراكب.',
  'phase.status.sign': 'صُدِّر مظهر توقيع مرئي محليًا؛ وهو ليس توقيعًا رقميًا مدعومًا بشهادة.',
  'phase.status.requestPackage':
    'حزمة طلب محلية جاهزة. لا يُرسَل التسليم: اضبط بريدك أو واجهة التوقيع الخاصة بك صراحةً.',
  'phase.status.password':
    'وُلد كلمة مرور محلية يقارب طولها {value} بت. انسخها من هذه الصفحة؛ فهي غير مخزَّنة.',
  'phase.status.edit':
    'صُدِّر تعديل النص محليًا. إذا تعذّر تحرير الخط في مكانه، استخدم المحرك مربع النص موسومًا.',
  'phase.status.annotate': 'صُدِّر تعليق PDF قياسي محليًا.',
  'phase.status.addText': 'صُدِّر مربع النص محليًا.',
  'phase.status.addImage': 'وُضعت الصورة محليًا.',
  'phase.status.headers': 'فُصلت رموز الرأس والتذييل محليًا.',
  'phase.status.pageNumbers': 'صُدِّرت أرقام الصفحات محليًا.',
  'phase.status.watermark': 'صُدِّرت العلامة المائية محليًا.',
  'phase.status.overlay': 'صُدِّر تراكب PDF محليًا.',
  'phase.status.createForm': 'أُنشئت حقول AcroForm محليًا.',
  'phase.status.fillForm': 'مُلئت حقول AcroForm المدعومة محليًا.',
  'phase.status.audit': 'اكتمل فحص الوصول. ما زال التحرير يدويًا مطلوبًا حيث تنقص الوسوم.',
};
