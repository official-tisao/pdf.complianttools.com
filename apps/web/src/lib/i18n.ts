/**
 * Message boundary for user-facing strings.
 *
 * Modelled on image.complianttools.com §21, which this project mirrors: the
 * source locale is English, `en-XA` is a pseudo-locale that accents and pads
 * every string to expose hardcoded copy and layout overflow, and `ar` catches
 * directional bugs. A key with no Arabic entry falls back to the English
 * source, which is why a missing translation degrades visibly rather than
 * silently rendering an empty control.
 *
 * Every call site passes the English string as the fallback, so a component
 * rendered without a catalogue still reads correctly — the catalogue adds
 * translation, it does not supply the copy.
 */
export type Locale = 'en' | 'en-XA' | 'ar';

/** Translators: keep product and format names unchanged; preserve {value}. */
const arabic: Readonly<Record<string, string>> = {
  'invoice.legend.invoice': 'الفاتورة',
  'invoice.legend.from': 'من',
  'invoice.legend.billTo': 'الفاتورة إلى',
  'invoice.legend.lines': 'بنود الفاتورة',
  'invoice.legend.totals': 'المجاميع',
  'invoice.legend.notes': 'ملاحظات',
  'invoice.legend.templates': 'قوالب',
  'invoice.field.number': 'رقم الفاتورة',
  'invoice.field.issueDate': 'تاريخ الإصدار',
  'invoice.field.dueDate': 'تاريخ الاستحقاق',
  'invoice.field.currency': 'العملة (رمز ISO من ثلاثة أحرف)',
  'invoice.field.supplierName': 'اسم المورّد',
  'invoice.field.supplierAddress': 'العنوان',
  'invoice.field.supplierTaxId': 'الرقم الضريبي',
  'invoice.field.customerName': 'اسم العميل',
  'invoice.field.customerAddress': 'العنوان',
  'invoice.field.customerTaxId': 'الرقم الضريبي',
  'invoice.field.description': 'الوصف',
  'invoice.field.quantity': 'الكمية',
  'invoice.field.unitPrice': 'سعر الوحدة',
  'invoice.field.taxPercent': 'نسبة الضريبة %',
  'invoice.field.notes': 'ملاحظات على الفاتورة',
  'invoice.field.templateName': 'اسم القالب',
  'invoice.action.addLine': 'إضافة بند',
  'invoice.action.removeLine': 'إزالة',
  'invoice.action.create': 'إنشاء ملف PDF للفاتورة',
  'invoice.action.createWithXml': 'إنشاء فاتورة مع مرفق XML منظّم',
  'invoice.action.saveTemplate': 'حفظ القالب',
  'invoice.action.loadTemplate': 'تحميل',
  'invoice.action.deleteTemplate': 'حذف',
  'invoice.total.net': 'الصافي',
  'invoice.total.tax': 'الضريبة',
  'invoice.total.gross': 'الإجمالي',
  'invoice.template.name': 'القالب',
  'invoice.template.save': 'حفظ القالب',
  'invoice.template.none': 'لا توجد قوالب محفوظة بعد.',
  'invoice.template.localOnly':
    'تُحفظ القوالب في تخزين المتصفح هذا فقط. لا تُرفع أبدًا، ومسح بيانات الموقع يزيلها.',
  'invoice.offline':
    'تعمل هذه الأداة دون اتصال بعد أن تزورها مرة واحدة. لا يُرفع أي شيء في أي وقت، متصلًا كان أو غير متصل.',
  'invoice.preview.fidelity':
    'تأتي مجاميع المعاينة من الدالة نفسها في المحرك التي ينتج منها التصدير، فلا يمكن أن تتعارضا.',
  'invoice.audit.honest':
    'راجع كل مبلغ قبل إصدار مستند تجاري. لا تتحقق هذه الأداة من معدلات الضريبة أو أرقام التسجيل أو الامتثال القانوني.',
  'invoice.audit.schema':
    'يتحقق الملف من قواعد بنيوية محلية. التحقق من مخطط UBL المنشور غير متاح في أداة تعمل داخل المتصفح وحده، فتحقق من الملف المُصدَّر مقابل المخطط الذي يطلبه المستلم.',
  'invoice.dropzone.hint': 'أفلت ملفًا هنا أو الصقه، أو اختر ملفًا.',
  'faq.einvoice.network': 'هل تُرسل فاتورتي إلى خادم؟',
  'faq.einvoice.networkBody':
    'لا. كل التحويلات هنا تعمل في علامة تبويب المتصفح هذه. أدوات الذكاء الاصطناعي والتقاط صفحات الويب هما الجزء الوحيد من الموقع القادر على الاتصال بنقطة نهاية شبكية، وكل منهما يصرّح بذلك قبل أن يفعل.',
  'faq.einvoice.structural': 'ماذا يتحقق "التحقق البنيوي" فعليًا؟',
  'faq.einvoice.structuralBody':
    'إن كان المستند جيد الصياغة ويحمل العناصر التي يحتاجها المستهلك: تصريح XML ورقم فاتورة وتاريخ إصدار بصيغة ISO وعملة وبند واحد على الأقل وإجمالي ضريبة وإجمالي مستحق. ولا يتحقق من مخطط OASIS UBL المنشور، وهو ما لا يمكن لأداة تعمل داخل المتصفح وحده أن تفعله موثوقًا.',
  'faq.einvoice.recover': 'هل أستطيع استخراج بيانات فاتورتي من الملف PDF؟',
  'faq.einvoice.recoverBody':
    'نعم، إذا كان الملف PDF يحمل مرفقًا منظّمًا — XML الذي يضمّنه هذا الأداة، مُستعادًا تمامًا كما كُتب. أما ملف PDF من مصدر آخر فلا يحمل بيانات منظّمة، وستخبرك الأداة بذلك بدل التخمين من الصفحة المعروضة.',
  'faq.einvoice.taxAuthority': 'هل سيفي هذا بمتطلبات مصلحة الضرائب؟',
  'faq.einvoice.taxAuthorityBody':
    'يعتمد ذلك على ولايتك القضائية ولا تستطيع هذه الأداة الإجابة. تنتج ملف PDF قابلًا للقراءة ونسخة XML منظّمة، أما استيفاء أي متطلب أو التزام فمسؤوليتك ومحاسبك.',
  'einvoice.heading.xmlToPdf': 'تحويل ملف XML للفاتورة الإلكترونية إلى PDF',
  'einvoice.heading.recover': 'استعادة XML من ملف PDF هجين',
  'einvoice.drop.xml': 'ملف XML للفاتورة الإلكترونية',
  'einvoice.drop.pdf': 'ملف PDF هجين يتضمن فاتورة مدمجة',
  'einvoice.drop.xmlBody':
    'أفلت ملف XML لفاتورة إلكترونية لعرض حقوله في ملف PDF. تُقرأ الملفات في علامة التبويب هذه ولا تُرفع أبدًا.',
  'einvoice.drop.pdfBody':
    'أفلت ملف PDF يتضمن ملف XML مدمجًا لفاتورة إلكترونية لاستعادة ذلك XML نفسه بدقة. تُقرأ الملفات في علامة التبويب هذه ولا تُرفع أبدًا.',
  'einvoice.drop.pdfHelp':
    'يقرأ هذا المرفق المنظّم فقط. لا يستنتج حقول الفاتورة من الصفحة المعروضة، لأن قراءة مبلغ خطأ تعني فاتورة خطأ؛ وإن لم يحتوِ ملف PDF على XML مدمج فلا توجد بيانات منظّمة يمكن استعادتها، وستُبلَّغ بذلك بدلاً من التخمين.',
  'einvoice.drop.xmlHelp':
    'يُفحص XML أولًا مقابل القواعد البنيوية المحلية. يُبلَّغ عن الملف الفاشل بسببه المحدد ولا يُحوَّل.',
  'faq.invoice.upload': 'هل تُرفع تفاصيل فاتورتي إلى أي مكان؟',
  'faq.invoice.uploadBody':
    'لا. تُبنى الفاتورة وتُعرض في علامة التبويب هذه داخل المتصفح بالكامل. لا يُرسل أي شيء إلى خادم، وتُحفظ القوالب في تخزين المتصفح نفسه — مسح بيانات الموقع يزيلها.',
  'faq.invoice.xml': 'ما ملف XML المرفق بالـ PDF؟',
  'faq.invoice.xmlBody':
    'إنه نسخة منظّمة من الفاتورة نفسها — رقمها وتواريخها وطرفيها وكل بند مع ضريبه ومجاميعها — مضمّنة كملف داخل الـ PDF. لا يحتاج النظام القارئ إليه إلى كشط الصفحة المعروضة.',
  'faq.invoice.schema': 'هل الفاتورة مُتحقَّق منها مقابل مخطط UBL الرسمي؟',
  'faq.invoice.schemaBody':
    'ليس بعد. يُفحص XML مقابل مجموعة من القواعد البنيوية ويجتازها الملف، لكن التحقق الكامل مقابل مخطط OASIS المنشور غير متاح في أداة تعمل داخل المتصفح وحده. تحقّق من الملف المُصدَّر مقابل المخطط الذي يطلبه المستلم قبل إرساله.',
  'faq.invoice.compliance': 'هل سيفي هذا بمتطلبات مصلحة الضرائب؟',
  'faq.invoice.complianceBody':
    'يعتمد ذلك على ولايتك القضائية ولا تستطيع هذه الأداة الإجابة عن ذلك. تنتج ملف PDF قابلًا للقراءة ونسخة XML منظّمة، أما استيفاء أي متطلب أو التزام فمسؤوليتك ومحاسبك.',
  'noscript.invoice':
    'يعمل منشئ الفواتورة هذا في متصفحك بالكامل ويحتاج تفعيل JavaScript. بدونه يظهر النموذج أعلاه لكنه لا يستطيع حساب المجاميع أو إنتاج ملف PDF. لا يُرسل أي شيء إلى خادم في أي وقت.',
  'noscript.einvoice':
    'تعمل هذه التحويلات في متصفحك بالكامل وتحتاج تفعيل JavaScript. منتقيات الملفات أعلاه ظاهرة بدونه لكنها لا تستطيع قراءة ملف أو إنتاج PDF. لا يُرفع ما تختاره.',
};

const accents: Readonly<Record<string, string>> = {
  A: 'Á',
  B: 'Ɓ',
  C: 'Ć',
  D: 'Ď',
  E: 'É',
  F: 'Ƒ',
  G: 'Ǧ',
  H: 'Ȟ',
  I: 'Ï',
  J: 'Ĵ',
  K: 'Ķ',
  L: 'Ĺ',
  M: 'Ṁ',
  N: 'Ǹ',
  O: 'Ô',
  P: 'Ṗ',
  Q: 'Q́',
  R: 'Ŕ',
  S: 'Ś',
  T: 'Ť',
  U: 'Ü',
  V: 'Ṽ',
  W: 'Ŵ',
  X: 'Ẋ',
  Y: 'Ý',
  Z: 'Ž',
};

/**
 * Pseudo-localises a string: accented letters plus padding proportional to the
 * original length. The padding is what surfaces overflow, since the rendered
 * text is materially longer than the English it stands in for.
 */
function pseudo(value: string): string {
  const expanded = value
    .split(/(\{[^{}]+\})/u)
    .map((part) =>
      part.startsWith('{') ? part : [...part].map((letter) => accents[letter] ?? letter).join(''),
    )
    .join('');
  return `［${expanded} ${'~'.repeat(Math.max(2, Math.ceil(value.length / 5)))}］`;
}

export function translate(
  locale: Locale,
  key: string,
  fallback: string,
  value?: string | number,
): string {
  const message =
    locale === 'ar' ? (arabic[key] ?? fallback) : locale === 'en-XA' ? pseudo(fallback) : fallback;
  return message.replace('{value}', value !== undefined ? String(value) : '');
}

/** `<html lang>` and `<main dir>` for a locale, per the sibling project's markup. */
export function localeAttributes(locale: Locale): { lang: string; dir: 'ltr' | 'rtl' } {
  return { lang: locale === 'en-XA' ? 'en-XA' : locale, dir: locale === 'ar' ? 'rtl' : 'ltr' };
}

/** The catalogue's key set, for the test that proves no string was left behind. */
export const messageKeys: readonly string[] = Object.keys(arabic);
