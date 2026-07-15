# Helpy QA Matrix

## Desktop Layout Matrix

| Scenario               | Expected Result                                                            |
| ---------------------- | -------------------------------------------------------------------------- |
| `768px` width window   | Navigation, forms, task cards, and settings remain usable without clipping |
| `1024px` width window  | Default desktop experience is stable and readable                          |
| `1440px+` width window | Layout uses available space without excessive empty gaps or overlap        |

## Theme And Accessibility Matrix

| Scenario               | Expected Result                                             |
| ---------------------- | ----------------------------------------------------------- |
| Light theme            | Text, cards, focus states, and buttons remain readable      |
| Dark theme             | Status chips, empty states, and helper text remain readable |
| High contrast          | Important controls and text maintain strong contrast        |
| Low motion / no motion | Decorative transitions are reduced or removed               |
| UI scale changes       | Content remains legible and the layout stays intact         |

## Personalization Matrix

| Scenario                  | Expected Result                                                       |
| ------------------------- | --------------------------------------------------------------------- |
| No preferred name saved   | Helpy uses stable fallback copy                                       |
| Preferred name saved      | Greeting, reminders, and extension status copy use the preferred name |
| Spoken reminders disabled | Helpy stays text-only                                                 |
| Spoken reminders enabled  | Supported messages can be read aloud without blocking the UI          |

## Extension Integration Matrix

| Scenario                    | Expected Result                                                       |
| --------------------------- | --------------------------------------------------------------------- |
| App starts before extension | Extension connects after popup/options interaction or polling refresh |
| Extension starts before app | Popup shows unavailable state, then reconnects after app launch       |
| Tracking paused             | Popup and desktop UI reflect the paused state                         |
| Bridge refresh needed       | Popup explains that the secure local bridge needs refresh             |

## Core Workflow Matrix

| Scenario              | Expected Result                                                |
| --------------------- | -------------------------------------------------------------- |
| Add task              | Task appears immediately with expected metadata                |
| Edit task             | Changes persist and modal focus returns correctly              |
| Complete/archive task | Counts and filtered views update correctly                     |
| Run focus session     | Timer controls and active task banner update correctly         |
| Daily summary test    | Notification path works and optional TTS can speak the summary |
| Export data           | JSON export downloads successfully                             |

## Release Validation Matrix

| Scenario               | Expected Result                                                 |
| ---------------------- | --------------------------------------------------------------- |
| Fresh packaged install | App launches and settings persist after restart                 |
| Chrome extension load  | Extension installs from unpacked folder without manifest errors |
| Installer docs         | `INSTALL.md` matches actual user steps                          |
