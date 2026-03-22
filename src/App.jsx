import { useState, useEffect, useRef } from "react";
import { PLANT_TYPES, getDifficultyColor, getWateringStatus } from "./plantData";
import "./App.css";

const STORAGE_KEY = "plant-tracker-plants-v1";
const CUSTOM_TYPES_KEY = "plant-tracker-custom-types-v1";
const STATUS_ORDER = { overdue: 0, today: 1, soon: 2, ok: 3, unknown: 4 };
const PLANT_EMOJIS = ["🌿","🌱","🌳","🌴","🌵","🌸","🌺","🌻","🌹","💐","🍀","🪴","🌾","🍃","💜","🌲","🎋","🎍","🌼","🌷","🪷","🍁","🍂","🎄"];

async function identifyPlant(base64Image, mediaType, apiKey) {
  const catalogList = PLANT_TYPES.map((p) => `${p.id}: ${p.name}`).join("\n");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-opus-4-6",
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64Image } },
          {
            type: "text",
            text: `Identify the plant in this photo. Our plant catalog:\n${catalogList}\n\nRespond with ONLY a valid JSON object — no markdown, no code fences:\n{"identified_name":"Common plant name","confidence":"high|medium|low","catalog_matches":["id1","id2"],"custom_suggestion":{"name":"...","emoji":"🌿","wateringIntervalDays":7,"difficulty":"Easy|Moderate|Hard","light":"...","tips":["tip1","tip2","tip3","tip4","tip5"]}}\n\ncatalog_matches: up to 3 IDs from the catalog that best match (empty array if none match well). custom_suggestion: always provide with accurate care info for the identified plant.`,
          },
        ],
      }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Request failed (${res.status})`);
  }
  const data = await res.json();
  let text = data.content[0].text.trim();
  text = text.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?\s*```$/, "");
  return JSON.parse(text);
}

function AddPlantModal({ onAdd, onClose }) {
  const [selectedType, setSelectedType] = useState("");
  const [nickname, setNickname] = useState("");
  const [location, setLocation] = useState("");
  const [lastWatered, setLastWatered] = useState(new Date().toISOString().split("T")[0]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!selectedType) return;
    const type = PLANT_TYPES.find((p) => p.id === selectedType);
    onAdd({ id: Date.now(), typeId: selectedType, nickname: nickname || type.name, location, lastWatered });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add a Plant</h2>
        <form onSubmit={handleSubmit}>
          <label>
            Plant Type *
            <select value={selectedType} onChange={(e) => setSelectedType(e.target.value)} required>
              <option value="">— Select a plant —</option>
              {PLANT_TYPES.map((p) => (
                <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>
              ))}
            </select>
          </label>
          <label>
            Nickname
            <input type="text" placeholder="e.g. Living Room Monstera" value={nickname} onChange={(e) => setNickname(e.target.value)} />
          </label>
          <label>
            Location
            <input type="text" placeholder="e.g. Kitchen windowsill" value={location} onChange={(e) => setLocation(e.target.value)} />
          </label>
          <label>
            Last Watered
            <input type="date" value={lastWatered} max={new Date().toISOString().split("T")[0]} onChange={(e) => setLastWatered(e.target.value)} />
          </label>
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={!selectedType}>Add Plant</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddCustomPlantModal({ onAdd, onAddCatalog, onClose }) {
  const today = new Date().toISOString().split("T")[0];
  // Steps: 'photo' | 'identifying' | 'results' | 'confirm' | 'manual'
  const [step, setStep] = useState("photo");

  // Photo + API key
  const [photoBase64, setPhotoBase64] = useState(null);
  const [photoMediaType, setPhotoMediaType] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("plant-tracker-api-key") || "");
  const [showApiKey, setShowApiKey] = useState(false);
  const [identifyResult, setIdentifyResult] = useState(null);
  const [identifyError, setIdentifyError] = useState("");

  // Catalog match selection
  const [selectedType, setSelectedType] = useState(null);

  // Plant instance fields (shared across steps)
  const [nickname, setNickname] = useState("");
  const [location, setLocation] = useState("");
  const [lastWatered, setLastWatered] = useState(today);

  // Custom type fields
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🌿");
  const [wateringDays, setWateringDays] = useState(7);
  const [difficulty, setDifficulty] = useState("Easy");
  const [light, setLight] = useState("");
  const [tips, setTips] = useState(["", "", "", "", ""]);

  const handlePhotoFile = (file) => {
    if (!file) return;
    const mt = file.type || "image/jpeg";
    if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mt)) {
      setIdentifyError("Unsupported format. Please use JPEG, PNG, GIF, or WebP.");
      return;
    }
    setIdentifyError("");
    setPhotoPreview(URL.createObjectURL(file));
    setPhotoMediaType(mt);
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoBase64(ev.target.result.split(",")[1]);
    reader.readAsDataURL(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handlePhotoFile(file);
  };

  const handleIdentify = async () => {
    if (!photoBase64 || !apiKey.trim()) return;
    localStorage.setItem("plant-tracker-api-key", apiKey.trim());
    setIdentifyError("");
    setStep("identifying");
    try {
      const result = await identifyPlant(photoBase64, photoMediaType, apiKey.trim());
      setIdentifyResult(result);
      if (result.custom_suggestion) {
        const s = result.custom_suggestion;
        setName(result.identified_name || s.name || "");
        setEmoji(PLANT_EMOJIS.includes(s.emoji) ? s.emoji : "🌿");
        setWateringDays(Math.max(1, Number(s.wateringIntervalDays) || 7));
        setDifficulty(["Easy", "Moderate", "Hard"].includes(s.difficulty) ? s.difficulty : "Easy");
        setLight(s.light || "");
        const t = Array.isArray(s.tips) ? s.tips : [];
        setTips([...t, "", "", "", "", ""].slice(0, 5));
      }
      setStep("results");
    } catch (err) {
      setIdentifyError(err.message);
      setStep("photo");
    }
  };

  const handleSelectCatalogType = (type) => {
    setSelectedType(type);
    setNickname("");
    setLocation("");
    setLastWatered(today);
    setStep("confirm");
  };

  const handleConfirmCatalog = (e) => {
    e.preventDefault();
    onAddCatalog({
      id: Date.now(),
      typeId: selectedType.id,
      nickname: nickname.trim() || selectedType.name,
      location: location.trim(),
      lastWatered,
    });
    onClose();
  };

  const handleSubmitCustom = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    const filteredTips = tips.filter((t) => t.trim());
    onAdd(
      {
        name: name.trim(),
        emoji,
        wateringIntervalDays: Math.max(1, Number(wateringDays)),
        difficulty,
        light: light.trim() || "Unknown",
        tips: filteredTips.length > 0 ? filteredTips : [`Water every ${wateringDays} days.`],
      },
      {
        nickname: nickname.trim() || name.trim(),
        location: location.trim(),
        lastWatered,
      }
    );
    onClose();
  };

  const goBack = () => {
    if (step === "results") setStep("photo");
    else if (step === "confirm") setStep("results");
    else if (step === "manual") setStep(identifyResult ? "results" : "photo");
  };

  const canGoBack = ["results", "confirm", "manual"].includes(step);

  const stepTitles = {
    photo: "Unknown Plant",
    identifying: "Identifying…",
    results: "Results",
    confirm: selectedType ? `Add ${selectedType.name}` : "Confirm",
    manual: "Custom Plant Details",
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal custom-modal" onClick={(e) => e.stopPropagation()}>
        <div className="custom-modal-header">
          {canGoBack && (
            <button className="step-back-btn" type="button" onClick={goBack}>← Back</button>
          )}
          <h2 className="step-title">{stepTitles[step]}</h2>
          <button className="btn-icon delete-btn" type="button" onClick={onClose}>✕</button>
        </div>

        {/* ── PHOTO STEP ── */}
        {step === "photo" && (
          <div className="custom-step">
            <p className="step-hint">Upload a photo to identify your plant, or skip to add details manually.</p>

            <label
              className={`photo-zone ${photoPreview ? "has-photo" : ""}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
            >
              <input
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                onChange={(e) => handlePhotoFile(e.target.files[0])}
              />
              {photoPreview ? (
                <img src={photoPreview} alt="Plant" />
              ) : (
                <>
                  <span className="photo-zone-icon">📷</span>
                  <span className="photo-zone-label">Click or drag a photo here</span>
                  <span className="photo-zone-sublabel">JPEG · PNG · WebP · GIF</span>
                </>
              )}
            </label>

            {photoBase64 && (
              <div className="api-key-section">
                <div className="api-key-row">
                  <span className="api-key-label">Anthropic API Key</span>
                  <a
                    href="https://console.anthropic.com/settings/keys"
                    target="_blank"
                    rel="noreferrer"
                    className="api-key-link"
                  >
                    Get free key ↗
                  </a>
                </div>
                <div className="api-key-input-row">
                  <input
                    type={showApiKey ? "text" : "password"}
                    placeholder="sk-ant-..."
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="api-key-input"
                  />
                  <button type="button" className="api-key-toggle" onClick={() => setShowApiKey((v) => !v)}>
                    {showApiKey ? "Hide" : "Show"}
                  </button>
                </div>
                <p className="api-key-note">Stored locally in your browser · only sent to Anthropic</p>
              </div>
            )}

            {identifyError && <div className="identify-error">{identifyError}</div>}

            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setStep("manual")}>
                Skip → Add manually
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={!photoBase64 || !apiKey.trim()}
                onClick={handleIdentify}
              >
                🔍 Identify Plant
              </button>
            </div>
          </div>
        )}

        {/* ── IDENTIFYING STEP ── */}
        {step === "identifying" && (
          <div className="identifying-state">
            <div className="spinner" />
            <p className="identifying-text">Analyzing your plant…</p>
            <p className="identifying-sub">This may take a few seconds</p>
          </div>
        )}

        {/* ── RESULTS STEP ── */}
        {step === "results" && identifyResult && (() => {
          const matches = (identifyResult.catalog_matches || [])
            .map((id) => PLANT_TYPES.find((p) => p.id === id))
            .filter(Boolean);
          return (
            <div className="custom-step">
              <div className="identify-result">
                <div className="identified-name">{identifyResult.identified_name}</div>
                <div className="identified-confidence">
                  Confidence:{" "}
                  <span className={`conf-badge conf-${identifyResult.confidence}`}>
                    {identifyResult.confidence}
                  </span>
                </div>
              </div>

              {matches.length > 0 && (
                <>
                  <p className="results-section-label">Tap a match from our catalog to add it:</p>
                  <div className="match-cards">
                    {matches.map((type) => (
                      <button
                        type="button"
                        key={type.id}
                        className="match-card"
                        onClick={() => handleSelectCatalogType(type)}
                      >
                        <span className="match-card-emoji">{type.emoji}</span>
                        <span className="match-card-name">{type.name}</span>
                        <span className="match-card-meta">{type.difficulty} · 💧 {type.wateringIntervalDays}d</span>
                      </button>
                    ))}
                  </div>
                </>
              )}

              <button type="button" className="btn-secondary full-width" onClick={() => setStep("manual")}>
                ➕ Add as custom plant {identifyResult.custom_suggestion ? "(pre-filled)" : ""}
              </button>
            </div>
          );
        })()}

        {/* ── CONFIRM CATALOG STEP ── */}
        {step === "confirm" && selectedType && (
          <div className="custom-step">
            <div className="confirm-type-card">
              <span className="confirm-emoji">{selectedType.emoji}</span>
              <div>
                <div className="confirm-name">{selectedType.name}</div>
                <div className="confirm-meta">
                  {selectedType.difficulty} · 💡 {selectedType.light} · 💧 Every {selectedType.wateringIntervalDays}d
                </div>
              </div>
            </div>
            <form onSubmit={handleConfirmCatalog} style={{ display: "flex", flexDirection: "column", gap: "14px", marginTop: "16px" }}>
              <label>
                Nickname
                <input type="text" placeholder={selectedType.name} value={nickname} onChange={(e) => setNickname(e.target.value)} />
              </label>
              <label>
                Location
                <input type="text" placeholder="e.g. Living room shelf" value={location} onChange={(e) => setLocation(e.target.value)} />
              </label>
              <label>
                Last Watered
                <input type="date" value={lastWatered} max={today} onChange={(e) => setLastWatered(e.target.value)} />
              </label>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setStep("results")}>← Back</button>
                <button type="submit" className="btn-primary">Add Plant ✓</button>
              </div>
            </form>
          </div>
        )}

        {/* ── MANUAL CUSTOM FORM STEP ── */}
        {step === "manual" && (
          <div className="custom-step">
            <form onSubmit={handleSubmitCustom} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div className="emoji-name-row">
                <label className="emoji-label">
                  Emoji
                  <select className="emoji-select-input" value={emoji} onChange={(e) => setEmoji(e.target.value)}>
                    {PLANT_EMOJIS.map((e) => (
                      <option key={e} value={e}>{e}</option>
                    ))}
                  </select>
                </label>
                <label style={{ flex: 1 }}>
                  Plant Name *
                  <input type="text" placeholder="e.g. Elephant Bush" value={name} onChange={(e) => setName(e.target.value)} required />
                </label>
              </div>

              <label>
                Watering Interval
                <div className="watering-interval-row">
                  <span>Every</span>
                  <input
                    type="number"
                    min="1"
                    max="90"
                    value={wateringDays}
                    onChange={(e) => setWateringDays(Number(e.target.value))}
                    className="interval-input"
                  />
                  <span>days</span>
                </div>
              </label>

              <div className="form-field">
                <span className="form-field-label">Difficulty</span>
                <div className="difficulty-btns">
                  {["Easy", "Moderate", "Hard"].map((d) => (
                    <button
                      type="button"
                      key={d}
                      className={`diff-btn ${difficulty === d ? "active" : ""}`}
                      onClick={() => setDifficulty(d)}
                      style={difficulty === d ? { background: getDifficultyColor(d), color: "white", borderColor: getDifficultyColor(d) } : {}}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              <label>
                Light Requirements
                <input type="text" placeholder="e.g. Bright indirect" value={light} onChange={(e) => setLight(e.target.value)} />
              </label>

              <div className="form-field">
                <span className="form-field-label">Care Tips (optional)</span>
                <div className="tips-inputs">
                  {tips.map((tip, i) => (
                    <div key={i} className="tip-input-row">
                      <span className="tip-number">{i + 1}.</span>
                      <input
                        type="text"
                        placeholder={`Tip ${i + 1}`}
                        value={tip}
                        onChange={(e) => {
                          const next = [...tips];
                          next[i] = e.target.value;
                          setTips(next);
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <hr className="form-section-divider" />
              <p className="form-section-label">Plant Details</p>

              <label>
                Nickname
                <input type="text" placeholder={name || "My Plant"} value={nickname} onChange={(e) => setNickname(e.target.value)} />
              </label>
              <label>
                Location
                <input type="text" placeholder="e.g. Kitchen windowsill" value={location} onChange={(e) => setLocation(e.target.value)} />
              </label>
              <label>
                Last Watered
                <input type="date" value={lastWatered} max={today} onChange={(e) => setLastWatered(e.target.value)} />
              </label>

              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={goBack}>← Back</button>
                <button type="submit" className="btn-primary" disabled={!name.trim()}>Add Plant ✓</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

function EditPlantModal({ plant, onSave, onClose }) {
  const [selectedType, setSelectedType] = useState(plant.typeId);
  const [nickname, setNickname] = useState(plant.nickname);
  const [location, setLocation] = useState(plant.location || "");
  const [lastWatered, setLastWatered] = useState(plant.lastWatered || new Date().toISOString().split("T")[0]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const type = PLANT_TYPES.find((p) => p.id === selectedType);
    onSave(plant.id, {
      typeId: selectedType,
      nickname: nickname.trim() || (type ? type.name : plant.nickname),
      location: location.trim(),
      lastWatered,
    });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Edit Plant</h2>
        <form onSubmit={handleSubmit}>
          <label>
            Plant Type *
            <select value={selectedType} onChange={(e) => setSelectedType(e.target.value)} required>
              {PLANT_TYPES.map((p) => (
                <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>
              ))}
            </select>
          </label>
          <label>
            Nickname
            <input type="text" placeholder="e.g. Living Room Monstera" value={nickname} onChange={(e) => setNickname(e.target.value)} />
          </label>
          <label>
            Location
            <input type="text" placeholder="e.g. Kitchen windowsill" value={location} onChange={(e) => setLocation(e.target.value)} />
          </label>
          <label>
            Last Watered
            <input type="date" value={lastWatered} max={new Date().toISOString().split("T")[0]} onChange={(e) => setLastWatered(e.target.value)} />
          </label>
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary">Save Changes</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function JournalModal({ plant, plantType, onAddNote, onClose }) {
  const [text, setText] = useState("");
  const bottomRef = useRef(null);

  const handleAdd = (e) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    onAddNote(plant.id, trimmed);
    setText("");
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [plant.notes]);

  const formatDate = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
      " · " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal journal-modal" onClick={(e) => e.stopPropagation()}>
        <div className="journal-header">
          <span className="tips-emoji">{plantType.emoji}</span>
          <div>
            <h2>{plant.nickname}</h2>
            <p className="tips-type">Plant Journal</p>
          </div>
          <button className="btn-icon delete-btn journal-close" onClick={onClose}>✕</button>
        </div>
        <div className="journal-notes">
          {plant.notes.length === 0 ? (
            <div className="journal-empty">
              <span>📝</span>
              <p>No entries yet. Add your first observation below!</p>
            </div>
          ) : (
            plant.notes.map((note) => (
              <div key={note.id} className="journal-entry">
                <p className="journal-entry-text">{note.text}</p>
                <span className="journal-entry-date">{formatDate(note.timestamp)}</span>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
        <form className="journal-form" onSubmit={handleAdd}>
          <textarea
            className="journal-input"
            placeholder="e.g. New leaf sprouting, moved to brighter spot…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAdd(e); }}
          />
          <button type="submit" className="btn-primary full-width" disabled={!text.trim()}>+ Add Entry</button>
        </form>
      </div>
    </div>
  );
}

function TipsModal({ plant, plantType, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal tips-modal" onClick={(e) => e.stopPropagation()}>
        <div className="tips-header">
          <span className="tips-emoji">{plantType.emoji}</span>
          <div>
            <h2>{plant.nickname}</h2>
            <p className="tips-type">{plantType.name}{plantType.custom && " · Custom"}</p>
          </div>
        </div>
        <div className="tips-meta">
          <span className="meta-badge" style={{ background: getDifficultyColor(plantType.difficulty) + "22", color: getDifficultyColor(plantType.difficulty) }}>
            {plantType.difficulty}
          </span>
          <span className="meta-badge light-badge">💡 {plantType.light}</span>
          <span className="meta-badge water-badge">💧 Every {plantType.wateringIntervalDays}d</span>
        </div>
        {plantType.tips?.length > 0 && (
          <>
            <h3>Care Tips</h3>
            <ul className="tips-list">
              {plantType.tips.map((tip, i) => <li key={i}>{tip}</li>)}
            </ul>
          </>
        )}
        <button className="btn-primary full-width" onClick={onClose}>Got it!</button>
      </div>
    </div>
  );
}

function PlantCard({ plant, plantType, onWater, onDelete, onEdit, onShowTips, onShowJournal }) {
  const status = getWateringStatus(plant.lastWatered, plantType.wateringIntervalDays);
  const lastWateredDate = plant.lastWatered
    ? new Date(plant.lastWatered + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "Never";
  const progressPct = status.daysUntil !== null
    ? Math.max(0, Math.min(100, ((plantType.wateringIntervalDays - status.daysUntil) / plantType.wateringIntervalDays) * 100))
    : 0;

  return (
    <div className={`plant-card status-${status.status}`}>
      <div className="card-header">
        <div className="plant-emoji">{plantType.emoji}</div>
        <div className="plant-info">
          <h3>{plant.nickname}</h3>
          <p className="plant-type">{plantType.name}{plantType.custom && <span className="custom-badge">custom</span>}</p>
          {plant.location && <p className="plant-location">📍 {plant.location}</p>}
        </div>
        <div className="card-header-actions">
          <button className="btn-icon edit-btn" onClick={() => onEdit(plant)} title="Edit plant">✏️</button>
          <button className="btn-icon delete-btn" onClick={() => onDelete(plant.id)} title="Remove plant">✕</button>
        </div>
      </div>
      <div className="card-divider" />
      <div className="watering-section">
        <div className="watering-row">
          <div className="watering-col">
            <span className="watering-label">Last watered</span>
            <span className="watering-value">{lastWateredDate}</span>
          </div>
          <div className="watering-col right">
            <span className="watering-label">Next watering</span>
            <span className="watering-value" style={{ color: status.color }}>{status.label}</span>
          </div>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progressPct}%`, background: status.color }} />
        </div>
      </div>
      <div className="card-actions">
        <button className="btn-water" onClick={() => onWater(plant.id)}>💧 Water now</button>
        <button className="btn-tips" onClick={() => onShowTips(plant)}>🌿 Care tips</button>
        <button className="btn-journal" onClick={() => onShowJournal(plant)} title="Plant journal">
          📓{plant.notes?.length > 0 && <span className="journal-badge">{plant.notes.length}</span>}
        </button>
      </div>
    </div>
  );
}

function PlantRow({ plant, plantType, onWater, onDelete, onEdit, onShowTips, onShowJournal }) {
  const status = getWateringStatus(plant.lastWatered, plantType.wateringIntervalDays);
  return (
    <div className={`plant-row status-${status.status}`}>
      <span className="row-emoji">{plantType.emoji}</span>
      <div className="row-info">
        <span className="row-name">{plant.nickname}</span>
        <span className="row-meta">{plantType.name}{plant.location && ` · 📍 ${plant.location}`}</span>
      </div>
      <span className="row-status" style={{ color: status.color }}>{status.label}</span>
      <div className="row-actions">
        <button className="row-btn" onClick={() => onWater(plant.id)} title="Water now">💧</button>
        <button className="row-btn" onClick={() => onShowTips(plant)} title="Care tips">🌿</button>
        <button className="row-btn row-btn-journal" onClick={() => onShowJournal(plant)} title="Journal">
          📓{plant.notes?.length > 0 && <span className="journal-badge">{plant.notes.length}</span>}
        </button>
        <button className="row-btn" onClick={() => onEdit(plant)} title="Edit">✏️</button>
        <button className="btn-icon delete-btn" onClick={() => onDelete(plant.id)} title="Remove">✕</button>
      </div>
    </div>
  );
}

function SortBar({ sort, setSort, filter, setFilter, viewMode, setViewMode }) {
  const filters = [
    { key: "all", label: "All" },
    { key: "overdue", label: "🔴 Overdue" },
    { key: "today", label: "🟠 Today" },
    { key: "soon", label: "🟡 Soon" },
    { key: "ok", label: "🟢 OK" },
  ];
  return (
    <div className="sort-bar">
      <div className="filter-group">
        {filters.map((f) => (
          <button key={f.key} className={`filter-btn ${filter === f.key ? "active" : ""}`} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="sort-group">
        <label htmlFor="sort-select">Sort:</label>
        <select id="sort-select" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="urgency">By urgency</option>
          <option value="name">By name</option>
          <option value="type">By type</option>
        </select>
      </div>
      <div className="view-toggle">
        <button className={`view-btn ${viewMode === "grid" ? "active" : ""}`} onClick={() => setViewMode("grid")} title="Grid view">⊞</button>
        <button className={`view-btn ${viewMode === "list" ? "active" : ""}`} onClick={() => setViewMode("list")} title="List view">☰</button>
      </div>
    </div>
  );
}

export default function App() {
  const [plants, setPlants] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
  });
  const [customTypes, setCustomTypes] = useState(() => {
    try { return JSON.parse(localStorage.getItem(CUSTOM_TYPES_KEY) || "[]"); } catch { return []; }
  });

  const [showAdd, setShowAdd] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [editingPlant, setEditingPlant] = useState(null);
  const [tipsPlant, setTipsPlant] = useState(null);
  const [journalPlant, setJournalPlant] = useState(null);
  const [sort, setSort] = useState("urgency");
  const [filter, setFilter] = useState("all");
  const [viewMode, setViewMode] = useState("grid");

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(plants)); }, [plants]);
  useEffect(() => { localStorage.setItem(CUSTOM_TYPES_KEY, JSON.stringify(customTypes)); }, [customTypes]);

  const getType = (typeId) =>
    [...PLANT_TYPES, ...customTypes].find((t) => t.id === typeId) ||
    { id: typeId, name: "Unknown Plant", emoji: "🌿", wateringIntervalDays: 7, difficulty: "Easy", light: "Unknown", tips: [] };

  const addPlant = (plant) => setPlants((prev) => [...prev, { ...plant, notes: [] }]);
  const deletePlant = (id) => setPlants((prev) => prev.filter((p) => p.id !== id));
  const waterPlant = (id) =>
    setPlants((prev) => prev.map((p) => (p.id === id ? { ...p, lastWatered: new Date().toISOString().split("T")[0] } : p)));
  const editPlant = (id, updates) =>
    setPlants((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  const addCustomPlant = (typeData, plantData) => {
    const typeId = `custom_${Date.now()}`;
    setCustomTypes((prev) => [...prev, { ...typeData, id: typeId, custom: true }]);
    setPlants((prev) => [...prev, { id: Date.now() + 1, typeId, ...plantData, notes: [] }]);
  };
  const addNote = (plantId, text) => {
    const note = { id: Date.now(), text, timestamp: new Date().toISOString() };
    setPlants((prev) => prev.map((p) => (p.id === plantId ? { ...p, notes: [...(p.notes || []), note] } : p)));
    setJournalPlant((prev) => prev ? { ...prev, notes: [...(prev.notes || []), note] } : prev);
  };

  const enriched = plants.map((p) => {
    const type = getType(p.typeId);
    const status = getWateringStatus(p.lastWatered, type.wateringIntervalDays);
    return { plant: p, type, status };
  });

  const needsWater = enriched.filter(({ status }) => status.status === "overdue" || status.status === "today").length;
  const filtered = enriched.filter(({ status }) => filter === "all" || status.status === filter);
  const sorted = [...filtered].sort((a, b) => {
    if (sort === "urgency")
      return (STATUS_ORDER[a.status.status] - STATUS_ORDER[b.status.status]) || ((a.status.daysUntil ?? 999) - (b.status.daysUntil ?? 999));
    if (sort === "name") return a.plant.nickname.localeCompare(b.plant.nickname);
    if (sort === "type") return a.type.name.localeCompare(b.type.name);
    return 0;
  });

  const sharedProps = {
    onWater: waterPlant,
    onDelete: deletePlant,
    onEdit: setEditingPlant,
    onShowTips: setTipsPlant,
    onShowJournal: setJournalPlant,
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-inner">
          <div className="header-brand">
            <span className="brand-logo">🌱</span>
            <div>
              <h1>Plant Tracker</h1>
              <p className="brand-sub">Keep your plants happy and hydrated</p>
            </div>
          </div>
          <div className="header-actions">
            <button className="btn-identify-header" onClick={() => setShowCustom(true)}>
              🔍 Identify / Custom
            </button>
            <button className="btn-primary btn-add-header" onClick={() => setShowAdd(true)}>
              + Add Plant
            </button>
          </div>
        </div>
      </header>

      <main className="main-content">
        {needsWater > 0 && (
          <div className="alert-banner">
            💧 {needsWater} plant{needsWater !== 1 ? "s" : ""} need{needsWater === 1 ? "s" : ""} watering today!
          </div>
        )}

        {plants.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🌿</div>
            <h2>Your plant collection is empty</h2>
            <p>Add your first plant to start tracking its watering schedule and get personalized care tips.</p>
            <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
              <button className="btn-primary btn-large" onClick={() => setShowAdd(true)}>+ Add from catalog</button>
              <button className="btn-secondary btn-large" onClick={() => setShowCustom(true)}>🔍 Identify / Custom</button>
            </div>
          </div>
        ) : (
          <>
            <div className="plant-summary">
              <span>{plants.length} plant{plants.length !== 1 ? "s" : ""} in your home</span>
            </div>
            <SortBar sort={sort} setSort={setSort} filter={filter} setFilter={setFilter} viewMode={viewMode} setViewMode={setViewMode} />
            {sorted.length === 0 ? (
              <div className="empty-filter">No plants match this filter.</div>
            ) : viewMode === "grid" ? (
              <div className="plant-grid">
                {sorted.map(({ plant, type }) => <PlantCard key={plant.id} plant={plant} plantType={type} {...sharedProps} />)}
              </div>
            ) : (
              <div className="plant-list">
                {sorted.map(({ plant, type }) => <PlantRow key={plant.id} plant={plant} plantType={type} {...sharedProps} />)}
              </div>
            )}
          </>
        )}
      </main>

      {showAdd && <AddPlantModal onAdd={addPlant} onClose={() => setShowAdd(false)} />}
      {showCustom && (
        <AddCustomPlantModal
          onAdd={addCustomPlant}
          onAddCatalog={addPlant}
          onClose={() => setShowCustom(false)}
        />
      )}
      {editingPlant && <EditPlantModal plant={editingPlant} onSave={editPlant} onClose={() => setEditingPlant(null)} />}
      {tipsPlant && <TipsModal plant={tipsPlant} plantType={getType(tipsPlant.typeId)} onClose={() => setTipsPlant(null)} />}
      {journalPlant && (
        <JournalModal
          plant={journalPlant}
          plantType={getType(journalPlant.typeId)}
          onAddNote={addNote}
          onClose={() => setJournalPlant(null)}
        />
      )}
    </div>
  );
}
