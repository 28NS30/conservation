# zh-TW copy review

69 strings across five branches. Every one is machine-written Traditional Chinese
that no native reader has seen. The English is the source; the Chinese is what the site
will show a Taiwanese visitor.

**What to do:** read the 中文 column. If it is wrong, unnatural, or too formal for a
public conservation site, write the replacement in the blank line under it. Leave it
blank if it is fine. Keys marked *(rewrite)* already existed — the old wording is shown
so you can see what changed.

Tone already chosen: plain, second person, no exclamation marks, no 您.

---

## #44 Blur records nobody has identified

### `map.blurredUnknown`

| | |
|---|---|
| EN | Location blurred — species not identified |
| 中文 | 位置已模糊化（尚未辨識物種） |

改成：


### `footer.blurredCount` *(rewrite)*

| | |
|---|---|
| EN | {count} locations blurred |
| 舊 | {count} 筆敏感物種位置已模糊化 |
| 中文 | {count} 筆位置已模糊化 |

改成：


### `detail.blurredUnknownNotice`

| | |
|---|---|
| EN | {precision} — this record has not been identified, and until we know what the animal is we cannot tell whether it is sensitive. |
| 中文 | {precision}——這筆紀錄還沒辨識出物種；在還不知道是什麼動物之前，我們無法判斷牠是否敏感。 |

改成：


### `list.obscuredLegend` *(rewrite)*

| | |
|---|---|
| EN | This mark means the coordinates were generalised before publication: the species is protected or sensitive, or the record has not been identified yet. |
| 舊 | 此標記的座標屬於保育類或敏感物種，已模糊化後才公開。 |
| 中文 | 此標記表示座標已模糊化後才公開：物種屬保育類或敏感，或是這筆紀錄還沒辨識出物種。 |

改成：


### `statsPage.coverageBody` *(rewrite)*

| | |
|---|---|
| EN | Of {total} published records, {obscured} have blurred coordinates — either their species is flagged sensitive in TaiCOL, or the record has not been identified yet. They are still counted in every statistic here; only their mapped position is approximate. |
| 舊 | 共 {total} 筆公開紀錄中，有 {obscured} 筆的座標經過模糊化處理，因為所屬物種在 TaiCOL 被標記為敏感。這些紀錄仍列入所有統計，只是地圖上的位置不是實際地點。 |
| 中文 | 共 {total} 筆公開紀錄中，有 {obscured} 筆的座標經過模糊化處理：所屬物種在 TaiCOL 被標記為敏感，或是這筆紀錄還沒辨識出物種。這些紀錄仍列入所有統計，只是地圖上的位置不是實際地點。 |

改成：


### `season.obscuredNote` *(rewrite)*

| | |
|---|---|
| EN | {n} published records are left out of the squares above. Their location is published coarsely — the species is rated sensitive, or the record has not been identified — so crediting it to a {km} km square would credit the wrong one. They count in every other statistic on this site. |
| 舊 | 有 {n} 筆已發布記錄未計入上述方格。這些物種被列為敏感，座標以粗略方式發布，對應到 {km} 公里方格只會指向錯誤的一格。它們仍計入本站其他所有統計。 |
| 中文 | 有 {n} 筆已發布記錄未計入上述方格。這些紀錄的座標以粗略方式發布——物種被列為敏感，或是還沒辨識出物種——對應到 {km} 公里方格只會指向錯誤的一格。它們仍計入本站其他所有統計。 |

改成：



## #46 Map legend describes what the map draws

### `map.low` *(rewrite)*

| | |
|---|---|
| EN | Fewer |
| 舊 | 低 |
| 中文 | 少 |

改成：


### `map.high` *(rewrite)*

| | |
|---|---|
| EN | More |
| 舊 | 高 |
| 中文 | 多 |

改成：


### `map.perRecord`

| | |
|---|---|
| EN | Each dot is one record |
| 中文 | 每一點是一筆紀錄 |

改成：


### `map.colourLockedHeat`

| | |
|---|---|
| EN | Heat shows density only |
| 中文 | 熱區只能顯示密度 |

改成：


### `map.colourLockedPoints`

| | |
|---|---|
| EN | Single records are always coloured by type |
| 中文 | 個別紀錄一律依類型上色 |

改成：


### `list.viewOnMap`

| | |
|---|---|
| EN | View on map |
| 中文 | 在地圖上檢視 |

改成：



## #47 Stop telling visitors untrue things

### `site.tagline` *(rewrite)*

| | |
|---|---|
| EN | Taiwan · open wildlife records |
| 舊 | 路殺 · 外來入侵種 · 環境通報 |
| 中文 | 臺灣 · 公開野生動物紀錄 |

改成：


### `site.description` *(rewrite)*

| | |
|---|---|
| EN | An open map of wildlife records for Taiwan, built on TaiRON roadkill data. Anyone can add a report. |
| 舊 | 台灣路殺、外來入侵種與環境通報的公開熱點地圖。 |
| 中文 | 臺灣的公開野生動物紀錄地圖，資料來自路殺社（TaiRON），任何人都能通報。 |

改成：


### `map.regionLabel` *(rewrite)*

| | |
|---|---|
| EN | Map of wildlife records across Taiwan |
| 舊 | 臺灣生態通報熱點地圖 |
| 中文 | 臺灣野生動物紀錄地圖 |

改成：


### `report.speciesUnsureHint` *(rewrite)*

| | |
|---|---|
| EN | Better than a guess. We record it as unidentified, and a person identifies it before it appears. |
| 舊 | 這比亂猜好。我們會記錄為未鑑定，模型仍然會嘗試辨識。 |
| 中文 | 這比亂猜好。我們會記為未鑑定，由人確認物種後才公開。 |

改成：


### `species.beFirst` *(rewrite)*

| | |
|---|---|
| EN | Report this species |
| 舊 | 成為第一筆通報 |
| 中文 | 通報這個物種 |

改成：


### `errors.backHome` *(rewrite)*

| | |
|---|---|
| EN | Back to home |
| 舊 | 回到地圖 |
| 中文 | 回首頁 |

改成：


### `attribution.modelsBody` *(rewrite)*

| | |
|---|---|
| EN | Species identification uses BioCLIP 2 (MIT) for zero-shot classification and MegaDetector (MIT) for cropping. Candidates are restricted to species on the Taiwan checklist. It is not switched on yet; a person identifies unnamed reports. |
| 舊 | 物種辨識使用 BioCLIP 2（MIT 授權）進行零樣本分類，並以 MegaDetector（MIT 授權）裁切影像。候選名單限縮為臺灣物種名錄中的物種。 |
| 中文 | 物種辨識使用 BioCLIP 2（MIT 授權）進行零樣本分類，並以 MegaDetector（MIT 授權）裁切影像。候選名單限縮為臺灣物種名錄中的物種。目前尚未啟用；沒有物種名稱的通報由人確認。 |

改成：


### `about.whatBody` *(rewrite)*

| | |
|---|---|
| EN | An open map of wildlife records for Taiwan. Today's records were collected by 路殺社 (TaiRON) volunteers and released under CC BY 4.0. Anyone can report roadkill, an injured animal, an invasive species or a sighting; no account is needed. |
| 舊 | 一個公開的臺灣生態通報地圖。任何人都可以通報路殺、外來入侵種、受傷野生動物或一般目擊；有照片的通報會由開源 AI 模型嘗試辨識物種；所有人都可以看到彙整後的熱點地圖。 |
| 中文 | 一個公開的臺灣野生動物紀錄地圖。地圖上現有的紀錄由路殺社（TaiRON）志工收集，以 CC BY 4.0 釋出。任何人都可以通報路殺、受傷動物、外來入侵種或一般目擊，不需要帳號。 |

改成：


### `list.empty` *(rewrite)*

| | |
|---|---|
| EN | No records match this filter. |
| 舊 | 目前沒有通報。 |
| 中文 | 這個篩選條件下沒有紀錄。 |

改成：


### `season.noneYet` *(rewrite)*

| | |
|---|---|
| EN | A first record from a square that has never had one is the most useful thing anyone can file. |
| 舊 | 本季還沒有新的方格。一個從未有過任何記錄的地方，它的第一筆記錄是最有用的。 |
| 中文 | 一個從未有過任何記錄的地方，它的第一筆記錄是最有用的。 |

改成：


### `home.how2` *(rewrite)*

| | |
|---|---|
| EN | Name it, or leave it to us |
| 舊 | AI 協助辨識 |
| 中文 | 寫上物種，或交給我們 |

改成：


### `home.how2Body` *(rewrite)*

| | |
|---|---|
| EN | If you know the animal, say so and the record is published as you gave it. If not, a person identifies it before it appears. |
| 舊 | 開源模型 BioCLIP 2 在臺灣物種名錄的範圍內比對。有把握時直接標定物種，沒把握時交給人判斷。 |
| 中文 | 知道是什麼動物就寫上，紀錄會照你寫的公開。不確定的，由人確認物種後才公開。 |

改成：


### `home.whatBody` *(rewrite)*

| | |
|---|---|
| EN | An open database of wildlife records for Taiwan. Anyone can report roadkill, an invasive species, an injured animal or a sighting; every record is public. We plan to publish reports made here to GBIF as a Darwin Core Archive. |
| 舊 | 一個公開的臺灣野生動物紀錄資料庫。任何人都可以通報路殺、外來入侵種、受傷動物或一般目擊；所有紀錄公開，並以 Darwin Core 標準回饋給 GBIF。 |
| 中文 | 一個公開的臺灣野生動物紀錄資料庫。任何人都可以通報路殺、外來入侵種、受傷動物或一般目擊；所有紀錄公開；我們計畫依 Darwin Core 標準，把在這裡通報的紀錄回饋給 GBIF。 |

改成：


### `home.taironBody` *(rewrite)*

| | |
|---|---|
| EN | Every record on this site was collected by 路殺社 (TaiRON) volunteers — crouching at the roadside, photographing, noting the species and the coordinate — and published openly under CC BY 4.0. This is not a replacement for that work: it shows those records, and plans to release new reports as open data in turn. |
| 舊 | 你在這裡看到的每一筆紀錄，都是路殺社的志工蹲在路邊、拍照、記下物種與座標收集來的，並以 CC BY 4.0 公開釋出。本站不是要取代這件事：我們呈現這些資料，也把新的通報整理成公開資料回饋出去。 |
| 中文 | 你在這裡看到的每一筆紀錄，都是路殺社的志工蹲在路邊、拍照、記下物種與座標收集來的，並以 CC BY 4.0 公開釋出。本站不是要取代這件事：我們呈現這些資料，也計畫把新的通報整理成公開資料回饋出去。 |

改成：



## #48 Stop throwing away what the reader chose

### `stats.month`

| | |
|---|---|
| EN | Month |
| 中文 | 月份 |

改成：


### `stats.year`

| | |
|---|---|
| EN | Year |
| 中文 | 年份 |

改成：


### `stats.count`

| | |
|---|---|
| EN | Records |
| 中文 | 筆數 |

改成：


### `stats.showNumbers`

| | |
|---|---|
| EN | Show the numbers |
| 中文 | 顯示數字 |

改成：


### `login.emailLabel`

| | |
|---|---|
| EN | Email |
| 中文 | 電子信箱 |

改成：


### `login.sentTo`

| | |
|---|---|
| EN | Sent to {email} |
| 中文 | 已寄到 {email} |

改成：


### `login.resend`

| | |
|---|---|
| EN | Send again |
| 中文 | 重新寄送 |

改成：


### `login.resendIn`

| | |
|---|---|
| EN | Send again in {seconds}s |
| 中文 | 重新寄送（{seconds} 秒） |

改成：


### `login.changeEmail`

| | |
|---|---|
| EN | Use a different address |
| 中文 | 換一個信箱 |

改成：


### `login.failed`

| | |
|---|---|
| EN | The link could not be sent. Please try again shortly. |
| 中文 | 寄不出去，請稍後再試。 |

改成：


### `login.tooMany`

| | |
|---|---|
| EN | Too many attempts. Wait a few minutes and try again. |
| 中文 | 嘗試次數太多，請等幾分鐘再試。 |

改成：


### `login.linkExpired`

| | |
|---|---|
| EN | That sign-in link is no longer valid. Send a new one. |
| 中文 | 登入連結已失效，請重新寄送。 |

改成：


### `species.noMatchesInFilter`

| | |
|---|---|
| EN | Nothing under "{filter}" matches "{q}". |
| 中文 | 「{filter}」裡沒有符合「{q}」的物種。 |

改成：


### `species.searchAllSpecies`

| | |
|---|---|
| EN | Search all species instead |
| 中文 | 改搜尋全部物種 |

改成：


### `species.range`

| | |
|---|---|
| EN | {from}–{to} of {total} species |
| 中文 | 第 {from}–{to} 種，共 {total} 種 |

改成：


### `list.filteredBy`

| | |
|---|---|
| EN | Filtered by |
| 中文 | 目前篩選 |

改成：


### `list.dateRange`

| | |
|---|---|
| EN | {from} to {to} |
| 中文 | {from} 至 {to} |

改成：


### `list.dateFrom`

| | |
|---|---|
| EN | From {from} |
| 中文 | {from} 起 |

改成：


### `list.dateTo`

| | |
|---|---|
| EN | Until {to} |
| 中文 | {to} 以前 |

改成：



## #49 Tell the reporter what the server said

### `report.tapToMark`

| | |
|---|---|
| EN | Tap the map to mark the spot |
| 中文 | 點地圖標出位置 |

改成：


### `report.locationError`

| | |
|---|---|
| EN | Couldn't get your location. Tap the map instead. |
| 中文 | 拿不到你的位置，請在地圖上點選。 |

改成：


### `report.errors.rate_limited`

| | |
|---|---|
| EN | Too many submissions just now. Try again in a few minutes. |
| 中文 | 送出太多次了，請過幾分鐘再試。 |

改成：


### `report.errors.challenge_failed`

| | |
|---|---|
| EN | The browser check didn't pass. Please try again. |
| 中文 | 瀏覽器驗證沒有通過，請再試一次。 |

改成：


### `report.errors.photo`

| | |
|---|---|
| EN | The photos couldn't be uploaded. Try again, or take them off and send. |
| 中文 | 照片傳不上去。可以重試，或拿掉照片再送。 |

改成：


### `report.errors.photoUnreadable`

| | |
|---|---|
| EN | This photo can't be read. Use a different one, or take it again. |
| 中文 | 這張照片讀不了，換一張或重拍。 |

改成：


### `report.errors.taxon_not_found`

| | |
|---|---|
| EN | That species can't be found. Please choose it again. |
| 中文 | 找不到這個物種，請重新選一次。 |

改成：


### `report.errors.validation_failed`

| | |
|---|---|
| EN | Something in the form isn't right. Check it and send again. |
| 中文 | 有欄位的內容不對，請檢查後再送。 |

改成：


### `report.errors.server`

| | |
|---|---|
| EN | Something went wrong at our end and the report was not sent. What you entered is still here. |
| 中文 | 伺服器出了問題，通報沒有送出。內容還在。 |

改成：


### `report.receipt.onMap`

| | |
|---|---|
| EN | It's on the map |
| 中文 | 已經在地圖上了 |

改成：


### `report.receipt.held`

| | |
|---|---|
| EN | Received. Not public yet. |
| 中文 | 收到了，還沒公開 |

改成：


### `report.receipt.withheld`

| | |
|---|---|
| EN | Received, and deliberately not shown |
| 中文 | 已收到，但不會公開顯示 |

改成：


### `report.receipt.heldForIdentification`

| | |
|---|---|
| EN | Someone has to identify the animal first. That is done by hand, with no timetable. |
| 中文 | 沒有物種名稱，要先確認是什麼動物才會公開。這是人工處理，時間不一定。 |

改成：


### `report.receipt.heldNoPhoto`

| | |
|---|---|
| EN | A person looks at reports without a photo first. |
| 中文 | 沒有照片的通報，會先由人看過才公開。 |

改成：


### `report.receipt.heldForReview`

| | |
|---|---|
| EN | A person will look at this report first. |
| 中文 | 這筆通報會先由人看過才公開。 |

改成：


### `report.receipt.withheldSpecies`

| | |
|---|---|
| EN | TaiCOL rates this species' coordinates as not for publication. The record is kept, but it does not appear on the map, in the report list or in any statistic. |
| 中文 | 臺灣物種名錄將這個物種的座標列為不公開。這筆紀錄會保存下來，但不會出現在地圖、通報列表或任何統計裡。 |

改成：


### `report.receipt.viewRecord`

| | |
|---|---|
| EN | View this record |
| 中文 | 看這筆紀錄 |

改成：


### `report.receipt.checkStatus`

| | |
|---|---|
| EN | Check its status |
| 中文 | 看目前狀態 |

改成：


### `report.receipt.another`

| | |
|---|---|
| EN | Report another |
| 中文 | 再通報一筆 |

改成：


### `report.noDispatch`

| | |
|---|---|
| EN | This only records what you saw. Nobody will be sent. |
| 中文 | 這裡只做紀錄，不會有人前往現場。 |

改成：


### `detail.receipt.title`

| | |
|---|---|
| EN | Received. Not public right now. |
| 中文 | 收到了，目前沒有公開 |

改成：


### `detail.receipt.body`

| | |
|---|---|
| EN | A person looks at reports without a photo or species name first. Some species' locations are never shown. |
| 中文 | 沒有照片或沒有物種名稱的通報，會先由人看過。部分物種的位置不會公開。 |

改成：


### `offline.sentCount` *(rewrite)*

| | |
|---|---|
| EN | {count, plural, one {Sent # report.} other {Sent # reports.}} |
| 舊 | 已送出 {count} 筆通報。 |
| 中文 | {count, plural, other {已送出 # 筆通報。}} |

改成：


### `offline.queueFailed` *(rewrite)*

| | |
|---|---|
| EN | This report could not be saved on your device, and was not sent. Check that your browser is not blocking storage, or that it is not full. |
| 舊 | 無法存到裝置 |
| 中文 | 這筆通報沒辦法存在你的裝置上，也還沒送出。請確認瀏覽器沒有封鎖儲存空間，或空間是否已滿。 |

改成：


