# Hand-built sets

Four sets built by hand on 2026-11-10 from two real spreadsheets and checked against one probed site.
Each `.json` file here is a set file in the format of `src/lib/pure/set-file.ts`: the app imports it,
and tests use it.

A set file holds only what a set stores. What the review found does not belong in it, so it is kept here:

- **Source**: where in the spreadsheet the columns came from.
- **Header**: the column header in the spreadsheet.
- **On site**: whether the field already existed on the probed site (`exists`) or would be created (`new`).
- **Near duplicate**: yes when the column was mapped to a site field with a close but different name.
- **Review**: the reviewer's note.
- **Skipped columns**: columns left out of the set, and why.

The import time in each file (`2026-11-10T00:00:00.000Z`) stands for the day they were built.

## On-set camera report: slate and take

`camera-report-slate.json`. Source: FlowStudioDemo.xlsx, sheet Sheet1 (wrangler camera report export, 72 columns, 5 takes).

| programmatic name | header | on site | near duplicate | review |
|---|---|---|---|---|
| `sg_slate` | Slates::Slate | exists |  |  |
| `sg_take` | Tk Take | exists |  |  |
| `sg_shoot_day` | Slates::Shoot Day | exists |  | The file holds a code such as SD01; the site field is a link to a Shoot Day record. |
| `sg_shoot_date` | Slates::Shoot Date | exists |  |  |
| `sg_unique_slate_id` | Slates::Unique Slate ID | new |  |  |
| `sg_slates_uuid` | Slates::SlatesUUID | new |  | Database key from the wrangler's app. Keep only if re-imports need to match rows. |
| `sg_takes_uuid` | Tk TakesUUID | new |  | Database key from the wrangler's app. Keep only if re-imports need to match rows. |
| `sg_vfx_shot` | Slates::VFX Shot | new |  | Column is empty in the sample; link to Shot is a guess. |
| `sg_scene` | Slates::Scene Number | exists | yes | The file holds a scene number as text; the site field is a link to a Scene record. |
| `sg_shoot_timestamp` | Slates::Shoot Timestamp | new |  | Column is empty in the sample; type is a guess from the name. |
| `sg_unit` | Slates::Unit | exists |  |  |
| `sg_element_type` | Slates::Element Type | new |  | Column is empty in the sample. |
| `sg_plate_type` | Slates::Plate Type | new |  | Column is empty in the sample. |
| `sg_vfx_work` | Slates::VFX Work | new |  | Several choices in one cell, one per line. Flow PT has no multi-choice list a tool can create, so text. |
| `sg_set_notes` | Slates::Notes | exists | yes |  |
| `sg_set_media` | Slates::Set Media | new |  | Several choices in one cell, one per line, so text. Column appears twice in the file. |
| `sg_set_location` | Slates::Set Location | new |  |  |
| `sg_script_location` | Slates::Script Location | exists |  | The file holds text such as ext_Battleground; the site field is a link. |
| `sg_day___night` | Slates::Script Time | exists | yes | The wrangler's app offers Day, Night, Dusk and Dawn. Check the site list holds all four. |
| `sg_int___ext` | Slates::Interior Exterior | exists | yes | The file holds Int and Ext. Check they match the site list's spelling. |
| `sg_wrangler` | Slates::Wrangler | new |  |  |
| `sg_camera_body` | Slates::Camera Body | exists |  |  |
| `sg_camera_id_1` | Slates::Camera Letter | exists | yes |  |
| `sg_camera_move` | Slates::Camera Move Description | exists | yes |  |
| `sg_camera_support` | Slates::Camera Mount | exists | yes |  |
| `sg_camera_head` | Slates::Camera Head | exists |  |  |
| `sg_asa` | Slates::ASA | exists |  |  |
| `sg_hdri_filename` | Slates::HDRI Filename | new |  |  |
| `sg_ball_and_chart_captured` | Slates::Ball and Chart Captured | new |  |  |
| `sg_asset_reference_number` | Slates::Asset Reference Number | new |  | Column is empty in the sample. |
| `sg_white_balance` | Slates::White Balance | exists |  |  |
| `sg_tilt_start` | Tk Camera Tilt | exists | yes |  |
| `sg_tilt_end` | Tk Camera Tilt End | exists | yes |  |
| `sg_lens` | Tk Lens ID | exists | yes | The file holds a lens description as text; the site field is a link to a Lenses record. |
| `sg_focal_length` | Tk Focal Length Start | exists | yes | The file also has Focal Length End, which stays a new field. |
| `sg_focal_length_end` | Tk Focal Length End | new |  | No matching field on the site; its start value maps to an existing field. |
| `sg_fps` | Tk FPS | exists |  | The site field holds whole numbers; 23.976 would not fit. |
| `sg_focus` | Tk Lens Focus | exists | yes | The file also has Lens Focus End, which stays a new field. |
| `sg_lens_focus_end` | Tk Lens Focus End | new |  | No matching field on the site; its start value maps to an existing field. |
| `sg_camera_height_start` | Tk Lens Height | exists | yes |  |
| `sg_camera_height_end` | Tk Lens Height End | exists | yes |  |
| `sg_roll` | Tk Roll | exists |  |  |
| `sg_filter_1` | Tk Filter | exists | yes |  |
| `sg_shutter_speed` | Tk Shutter Angle | exists | yes | The file holds a shutter angle in degrees; the site field is named for speed. |
| `sg_fstop` | Tk Stop | exists | yes |  |
| `sg_take_notes` | Tk Notes | exists |  | Matched by meaning, not by header text: the header is Notes on the take table. |

Skipped columns:

- Slates::Job: The production name. That is the project.
- Slates::Creation Date: Stock Date Created covers it.
- Slates::Modification Date: Stock Date Updated covers it.
- Slates::Diagram1 to Slates::Diagram8: Images. An image field cannot be created through the API.
- Slates::Scene Number, Slates::Set Media, Slates::Diagram4 (second occurrences): Duplicate column headers in the file.

## On-set camera report: lens

`camera-report-lens.json`. Source: FlowStudioDemo.xlsx, sheet Sheet1 (wrangler camera report export, 72 columns, 5 takes).

| programmatic name | header | on site | near duplicate | review |
|---|---|---|---|---|
| `sg_lens_serial_number` | Tk Lens Serial Num | exists | yes | Exported per take, but it belongs to the lens, so it sits in this set. |
| `sg_anamorphic_desqueeze_ratio` | Lens::Anamorphic Desqueeze Ratio | new |  | Values such as 1.8X, so text. |
| `sg_maximum_aperture` | Lens::Maximum Aperture | new |  |  |
| `sg_closed_focus` | Lens::Closed Focus | new |  | Feet and inches, so text. |
| `sg_grid_date` | Lens::Grid Date | new |  | Column is empty in the sample; type is a guess from the name. The entity has a Gridded? checkbox. |

## On-set camera report: virtual production

`camera-report-virtual-production.json`. Source: FlowStudioDemo.xlsx, sheet Sheet1 (wrangler camera report export, 72 columns, 5 takes).

| programmatic name | header | on site | near duplicate | review |
|---|---|---|---|---|
| `sg_unreal_environment` | Unreal Environment | new |  |  |
| `sg_unreal_snapshot_name` | Unreal Snapshot Name | new |  |  |
| `sg_unreal_take_name` | Unreal Take Name | new |  |  |
| `sg_vicon_take_name` | Vicon Take Name | new |  |  |
| `sg_ndisplay_color_correction` | nDisplay Color Correction | new |  |  |
| `sg_additional_notes_vp` | Additional Notes VP | new |  |  |
| `sg_distance_to_volume` | Distance to Volume | new |  | Kept as a new field. Distance to Subject exists on the site but measures something else: this is the distance to the LED volume. |

## Weekly status report

`weekly-status-report.json`. Source: 20260429_WSR_Test_v1.xlsx, first sheet, read from the Drive preview only (headers and first rows).

| programmatic name | header | on site | near duplicate | review |
|---|---|---|---|---|
| `sg_reel` | Reel | exists |  | The site also has a stock Reel field (reel). |
| `sg_sequence` | Sequence | exists |  |  |
| `code` | Shot Code | exists |  |  |
| `sg_status_list` | Status | exists |  |  |
| `sg_turnover_date` | Turnover Date | exists |  |  |
| `sg_vendor_groups` | Vendor | exists | yes | The file holds a vendor name as text; the site field is a link. |
| `sg_turnover` | Turnover | exists |  |  |
| `sg_latest_vendor_status` | Latest Vendor Status | exists |  |  |
| `sg_vendor_percentage_complete` | Vendor Percentage Complete | exists |  |  |
| `sg_date_next_version_expected` | Date Next Version Expected | exists |  |  |
| `sg_layout_due` | Layout Due | exists |  |  |
| `sg_final_anim_due` | Final Anim Due | exists |  |  |
| `sg_wip_comp_due` | WIP Comp Due | exists |  |  |
| `sg_final_notes_due` | Final Notes Due | exists |  |  |
| `sg_creative_final_due` | Creative Final Due | exists |  |  |
| `sg_tech_check_final_due` | Tech Check Final Due | exists |  |  |
| `sg_vfx_production_notes` | VFX Production Notes | exists |  |  |
| `sg_latest_vendor_notes` | Latest Vendor Notes | exists |  |  |
| `sg_report_date` | Report Date | exists |  |  |
