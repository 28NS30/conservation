import type { Locale } from "../../i18n/routing";

/**
 * Every string the lab invents, in both languages, in one file.
 *
 * NOT in `messages/*.json`. The lab is throwaway: putting prototype copy in the
 * live catalogues means the day the lab is deleted someone has to work out
 * which of two hundred keys were only ever a prototype's, and the ones they
 * miss stay in the product forever. Here, deleting the lab deletes the copy.
 *
 * Strings that already exist live — `nav.*`, `home.tagline`, `home.ctaReport`,
 * `footer.*`, `site.title` — are read from next-intl as usual and are NOT
 * repeated here. Reusing them is what makes the prototypes comparable with
 * today's pages: a difference the owner sees is a difference in the design and
 * not in the words.
 *
 * `satisfies Record<Locale, LabCopy>` is the parity guard. The type is declared
 * once and both locales are checked against it, so a key added to one and
 * forgotten in the other fails `npm run typecheck` rather than rendering an
 * English sentence in the middle of a Chinese page. `test/lab.test.mjs` checks
 * the same thing at runtime, because a `satisfies` is only as good as the next
 * person remembering to run the typechecker.
 *
 * ALL zh-TW here needs a native read before anyone outside the team is shown
 * these pages (brief W1, decision 7). Strings quoted verbatim from the two spec
 * chapters are marked; the rest are this file's own and are the ones most
 * likely to be wrong.
 */
export type LabCopy = {
  /** The lab's own furniture — never part of either design. */
  lab: {
    banner: string;
    bannerLong: string;
    indexTitle: string;
    indexLead: string;
    directionOnScreen: string;
    switchTo: string;
    todaysPage: string;
    notBuilt: string;
    primitives: string;
    primitivesLead: string;
    pageHome: string;
    pageMap: string;
    pageReportStepper: string;
    pageReportPhotoFirst: string;
    pageSpecies: string;
  };
  home: {
    /** Verbatim, direction.md §4. */
    sourceLine: string;
    mapSectionTitle: string;
    openFullMap: string;
    creditSentence: string;
    creditLink: string;
  };
  map: {
    tabMap: string;
    tabList: string;
    filters: string;
    displayLabel: string;
    displayGrid: string;
    displayDots: string;
    displayHeat: string;
    colourLabel: string;
    colourDensity: string;
    colourType: string;
    typeLabel: string;
    searchSpecies: string;
    years: string;
    legendLow: string;
    legendHigh: string;
    legendPoints: string;
    collapsePanel: string;
    expandPanel: string;
    recordSource: string;
    fullRecord: string;
    clearFilters: string;
    noRecords: string;
    blurredNotice: string;
  };
  species: {
    alsoCalled: string;
    findingSentence: string;
    findingNone: string;
    seeOnFullMap: string;
    seeRecordList: string;
    sawItTitle: string;
    reportThis: string;
    withheldNotice: string;
    monthlyTitle: string;
    lineage: string;
  };
  report: {
    leave: string;
    back: string;
    next: string;
    photoTitle: string;
    photoTake: string;
    photoLibrary: string;
    photoSkip: string;
    photoHelp: string;
    photoRemove: string;
    photoAddAnother: string;
    photoAdd: string;
    photoUnreadable: string;
    placeTitle: string;
    placeUseCurrent: string;
    placeUsePhoto: string;
    placeTapMap: string;
    placeMissing: string;
    placeAccuracy: string;
    placeDenied: string;
    placeMapUnavailable: string;
    conditionTitle: string;
    conditionDead: string;
    conditionHurt: string;
    conditionWell: string;
    injuredTitle: string;
    injuredBody: string;
    injuredAck: string;
    speciesTitle: string;
    speciesPlaceholder: string;
    speciesUnsure: string;
    speciesUnsureIntroduced: string;
    speciesOffline: string;
    speciesSkip: string;
    sendTitle: string;
    sendNote: string;
    timeFromPhoto: string;
    timeNow: string;
    captionNoPhoto: string;
    captionNoSpecies: string;
    captionMissing: string;
    captionChallenge: string;
    buttonChecking: string;
    buttonSend: string;
    buttonUploading: string;
    buttonSending: string;
    buttonSaveOnPhone: string;
    waitingChallenge: string;
    waitingSlow: string;
    startOver: string;
    removePhotosAndSend: string;
    errorServer: string;
    errorStorage: string;
  };
  receipt: {
    published: string;
    publishedLink: string;
    held: string;
    heldNoSpecies: string;
    heldNoPhoto: string;
    heldReview: string;
    queued: string;
    again: string;
    againSamePlace: string;
    backToMap: string;
    myReports: string;
  };
  status: {
    protected: string;
    endemic: string;
    invasive: string;
    blurred: string;
  };
  common: {
    nav: string;
    loading: string;
    skipToContent: string;
  };
};

const zhTW: LabCopy = {
  lab: {
    // Verbatim, brief W1: the bar that keeps a prototype from being read as a
    // promise about the words.
    banner: "原型，文字未定稿",
    bannerLong: "這是設計原型。版面在測試中，文字未定稿，通報不會送出。",
    indexTitle: "設計實驗室",
    indexLead:
      "同樣的內容，兩種外觀。在自己的手機上各走一遍，然後選一個。",
    directionOnScreen: "目前顯示",
    switchTo: "換成",
    todaysPage: "今天的頁面",
    notBuilt: "尚未建立",
    primitives: "元件樣張",
    primitivesLead:
      "每一個元件在這個主題下的樣子。換主題只換一個 CSS 檔，這一頁應該整頁跟著換。",
    pageHome: "首頁",
    pageMap: "地圖",
    pageReportStepper: "通報（一次一題）",
    pageReportPhotoFirst: "通報（照片優先）",
    pageSpecies: "物種頁",
  },
  home: {
    sourceLine: "紀錄來源：路殺社（TaiRON），CC BY 4.0",
    mapSectionTitle: "地圖",
    openFullMap: "開啟完整地圖",
    creditSentence: "這些紀錄，來自路殺社十多年來在路邊停下來的人。",
    creditLink: "關於這個計畫",
  },
  map: {
    tabMap: "地圖",
    tabList: "清單",
    filters: "篩選",
    displayLabel: "顯示",
    displayGrid: "方格",
    displayDots: "圓點",
    displayHeat: "熱區",
    colourLabel: "上色",
    colourDensity: "密度",
    colourType: "類型",
    typeLabel: "類型",
    searchSpecies: "搜尋物種",
    years: "年份",
    legendLow: "少",
    legendHigh: "多",
    legendPoints: "每一點是一筆紀錄",
    collapsePanel: "收合篩選",
    expandPanel: "展開篩選",
    recordSource: "紀錄來源：{source}",
    fullRecord: "完整紀錄",
    clearFilters: "清除篩選",
    noRecords: "這些條件下沒有公開紀錄。",
    blurredNotice: "這是敏感物種，地點已模糊化。",
  },
  species: {
    alsoCalled: "也稱作",
    // {from}–{to} 年間有 {count} 筆紀錄，{month}最多。 — verbatim shape from
    // direction.md §4; the page fills it in.
    findingSentence: "{from}–{to} 年間有 {count} 筆紀錄，{month}最多。",
    findingNone: "還沒有公開紀錄。",
    seeOnFullMap: "在完整地圖上看",
    seeRecordList: "看紀錄列表",
    sawItTitle: "看到牠了？",
    reportThis: "通報{name}",
    withheldNotice: "這個物種的紀錄不公開位置。",
    monthlyTitle: "每個月的紀錄",
    lineage: "分類",
  },
  report: {
    leave: "✕ 離開",
    back: "← 上一步",
    next: "下一步",
    photoTitle: "先拍一張",
    photoTake: "拍照",
    photoLibrary: "從相簿選",
    photoSkip: "沒有照片，直接繼續",
    photoHelp: "拍完就到下一步。",
    photoRemove: "移除",
    photoAddAnother: "再加一張（最多 4 張）",
    photoAdd: "加照片",
    photoUnreadable: "這張照片讀不了，換一張或重拍。",
    placeTitle: "在哪裡？",
    placeUseCurrent: "用我現在的位置",
    placeUsePhoto: "用照片的地點",
    placeTapMap: "點地圖標出位置",
    placeMissing: "先設定地點才能繼續",
    placeAccuracy: "誤差約 {m} 公尺",
    placeDenied: "拿不到你的位置，請在地圖上點選。",
    placeMapUnavailable: "地圖載不出來；用「我現在的位置」就可以。",
    conditionTitle: "牠的狀況？",
    conditionDead: "已死亡",
    conditionHurt: "活著，但受傷",
    conditionWell: "活著，沒事",
    injuredTitle: "我們不會派人過去",
    // Decision 6 is the owner's and it blocks shipping: never invent an agency
    // or a phone number. The prototype shows the shape of the notice and says
    // out loud that the words are missing.
    injuredBody: "文字待提供",
    injuredAck: "知道了，繼續",
    speciesTitle: "是什麼動物？",
    speciesPlaceholder: "輸入名稱，例如：石虎",
    speciesUnsure: "不確定",
    speciesUnsureIntroduced: "不確定，但應該是外來種",
    speciesOffline: "現在查不了名稱。",
    speciesSkip: "先略過",
    sendTitle: "確認後送出",
    sendNote: "補充說明或信箱（選填）",
    timeFromPhoto: "（照片時間）",
    timeNow: "（現在）",
    captionNoPhoto: "沒有照片的通報，會先由人看過才公開。",
    captionNoSpecies: "沒有物種名稱，要等確認物種後才會公開。",
    captionMissing: "還差：{what}",
    captionChallenge: "人機驗證",
    buttonChecking: "正在驗證瀏覽器…",
    buttonSend: "送出通報",
    buttonUploading: "上傳照片…",
    buttonSending: "送出中…",
    buttonSaveOnPhone: "先存在手機裡",
    waitingChallenge: "等不到驗證？先存在手機裡",
    waitingSlow: "訊號不好？先存在手機裡",
    startOver: "重新開始",
    removePhotosAndSend: "拿掉照片再送",
    errorServer: "伺服器出了問題，通報沒有送出。內容還在。",
    errorStorage: "存不進這支手機。請留在這一頁，有訊號後再送。",
  },
  receipt: {
    published: "已經在地圖上了",
    publishedLink: "看這筆紀錄",
    held: "收到了，還沒公開",
    heldNoSpecies:
      "沒有物種名稱，要先確認是什麼動物才會公開。這是人工處理，時間不一定。",
    heldNoPhoto: "沒有照片的通報，會先由人看過才公開。",
    heldReview: "這筆通報會先由人看過才公開。",
    queued: "存在手機裡了，還沒送出",
    again: "再通報一筆",
    againSamePlace: "同地點再一筆",
    backToMap: "回地圖",
    myReports: "我的通報",
  },
  status: {
    protected: "保育類",
    endemic: "特有種",
    invasive: "外來入侵種",
    blurred: "位置已模糊化",
  },
  common: {
    nav: "網站導覽",
    loading: "載入中",
    skipToContent: "跳到主要內容",
  },
};

const en: LabCopy = {
  lab: {
    banner: "Prototype, copy not final",
    bannerLong:
      "A design prototype. The layout is being tested, the words are not final, and nothing here is submitted.",
    indexTitle: "Design lab",
    indexLead:
      "The same content in two looks. Walk through both on your own phone, then pick one.",
    directionOnScreen: "On screen",
    switchTo: "Switch to",
    todaysPage: "Today's page",
    notBuilt: "Not built yet",
    primitives: "Primitives",
    primitivesLead:
      "Every component under this theme. Swapping the theme swaps one CSS file, and this whole page should change with it.",
    pageHome: "Home",
    pageMap: "Map",
    pageReportStepper: "Report (one question at a time)",
    pageReportPhotoFirst: "Report (photo first)",
    pageSpecies: "Species page",
  },
  home: {
    sourceLine: "Records from TaiRON, CC BY 4.0",
    mapSectionTitle: "The map",
    openFullMap: "Open the full map",
    creditSentence:
      "These records come from the people who have been stopping at the roadside for TaiRON for over a decade.",
    creditLink: "About this project",
  },
  map: {
    tabMap: "Map",
    tabList: "List",
    filters: "Filters",
    displayLabel: "Display",
    displayGrid: "Grid",
    displayDots: "Dots",
    displayHeat: "Heat",
    colourLabel: "Colour",
    colourDensity: "Density",
    colourType: "Type",
    typeLabel: "Type",
    searchSpecies: "Search species",
    years: "Years",
    legendLow: "Fewer",
    legendHigh: "More",
    legendPoints: "Each dot is one record",
    collapsePanel: "Collapse filters",
    expandPanel: "Expand filters",
    recordSource: "Record source: {source}",
    fullRecord: "Full record",
    clearFilters: "Clear filters",
    noRecords: "No public records match these filters.",
    blurredNotice: "A sensitive species: the location is blurred.",
  },
  species: {
    alsoCalled: "Also called",
    findingSentence:
      "{count} records between {from} and {to}, most of them in {month}.",
    findingNone: "No public records yet.",
    seeOnFullMap: "See on the full map",
    seeRecordList: "See the record list",
    sawItTitle: "Seen one?",
    reportThis: "Report {name}",
    withheldNotice: "Locations for this species are not published.",
    monthlyTitle: "Records by month",
    lineage: "Lineage",
  },
  report: {
    leave: "✕ Leave",
    back: "← Back",
    next: "Next",
    photoTitle: "Start with a photo",
    photoTake: "Take a photo",
    photoLibrary: "Choose from library",
    photoSkip: "Continue without a photo",
    photoHelp: "You go on once it's taken.",
    photoRemove: "Remove",
    photoAddAnother: "Add another (up to 4)",
    photoAdd: "Add photo",
    photoUnreadable: "That photo can't be read. Try another, or take a new one.",
    placeTitle: "Where was it?",
    placeUseCurrent: "Use where I am now",
    placeUsePhoto: "Use the photo's place",
    placeTapMap: "Tap the map to mark the spot",
    placeMissing: "Set a place to continue",
    placeAccuracy: "Accurate to about {m} m",
    placeDenied: "We can't get your location. Tap the map instead.",
    placeMapUnavailable: "The map won't load. \"Use where I am now\" still works.",
    conditionTitle: "How was it?",
    conditionDead: "Dead",
    conditionHurt: "Alive, but hurt",
    conditionWell: "Alive and well",
    injuredTitle: "Nobody will be sent",
    injuredBody: "Wording pending",
    injuredAck: "Understood, continue",
    speciesTitle: "What animal?",
    speciesPlaceholder: "Type a name, e.g. leopard cat",
    speciesUnsure: "Not sure",
    speciesUnsureIntroduced: "Not sure, but I think it's introduced",
    speciesOffline: "Names can't be searched right now.",
    speciesSkip: "Skip for now",
    sendTitle: "Check and send",
    sendNote: "Add a note or email (optional)",
    timeFromPhoto: "(from the photo)",
    timeNow: "(now)",
    captionNoPhoto: "Reports without a photo are checked by a person first.",
    captionNoSpecies:
      "Without a species name, this waits until the animal is identified.",
    captionMissing: "Still needed: {what}",
    captionChallenge: "the browser check",
    buttonChecking: "Checking your browser…",
    buttonSend: "Send report",
    buttonUploading: "Uploading photos…",
    buttonSending: "Sending…",
    buttonSaveOnPhone: "Save on this phone",
    waitingChallenge: "Check not finishing? Save on this phone",
    waitingSlow: "Poor signal? Save on this phone",
    startOver: "Start over",
    removePhotosAndSend: "Remove photos and send",
    errorServer:
      "The server had a problem and the report was not sent. Nothing you typed is lost.",
    errorStorage:
      "This phone won't store it. Stay on this page and send once you have signal.",
  },
  receipt: {
    published: "It's on the map",
    publishedLink: "See this record",
    held: "Received. Not public yet.",
    heldNoSpecies:
      "Without a species name it waits until the animal is identified. That is done by hand, with no timetable.",
    heldNoPhoto: "Reports without a photo are checked by a person first.",
    heldReview: "This report is checked by a person before it is published.",
    queued: "Saved on this phone. Not sent yet",
    again: "Report another",
    againSamePlace: "Another at this place",
    backToMap: "Back to the map",
    myReports: "My reports",
  },
  status: {
    protected: "Protected",
    endemic: "Endemic",
    invasive: "Invasive",
    blurred: "Location blurred",
  },
  common: {
    nav: "Site navigation",
    loading: "Loading",
    skipToContent: "Skip to content",
  },
};

export const LAB_COPY = { "zh-TW": zhTW, en } satisfies Record<Locale, LabCopy>;

export function getLabCopy(locale: string): LabCopy {
  return locale === "en" ? LAB_COPY.en : LAB_COPY["zh-TW"];
}
