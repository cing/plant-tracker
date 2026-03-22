import { useState, useEffect, useRef, useCallback } from "react";
import { PLANT_TYPES, getDifficultyColor, getWateringStatus } from "./plantData";
import "./App.css";

const STORAGE_KEY = "plant-tracker-plants-v1";
const CUSTOM_TYPES_KEY = "plant-tracker-custom-types-v1";
const SYNC_KEY_STORAGE = "plant-tracker-sync-key-v1";
const JSONBLOB_API = "https://jsonblob.com/api/jsonBlob";
const STATUS_ORDER = { overdue: 0, today: 1, soon: 2, ok: 3, unknown: 4 };
const PLANT_EMOJIS = ["🌿","🌱","🌳","🌴","🌵","🌸","🌺","🌻","🌹","💐","🍀","🪴","🌾","🍃","💜","🌲","🎋","🎍","🌼","🌷","🪷","🍁","🍂","🎄"];

async function createSyncBlob(data) {
  const res = await fetch(JSONBLOB_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const loc = res.headers.get("Location") || "";
  const id = loc.split("/").pop();
  if (!id) throw new Error("No ID in response");
  return id;
}

async function readSyncBlob(id) {
  const res = await fetch(`${JSONBLOB_API}/${id}`, {
    headers: { "Accept": "application/json" },
  });
  if (res.status === 404) throw new Error("Sync key not found");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function writeSyncBlob(id, data) {
  const res = await fetch(`${JSONBLOB_API}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function searchINaturalist(query) {
  const url = `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(query)}&per_page=12&rank=species,genus&is_active=true&locale=en&iconic_taxa=Plantae`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`iNaturalist search failed (${res.status})`);
  const data = await res.json();
  return data.results.filter((t) => t.default_photo);
}

const PLANTNET_KEY_STORAGE = "plant-tracker-plantnet-key";
const PLANTNET_WORKER_URL = "https://white-mode-0730.ing-chris.workers.dev";

async function identifyWithPlantNet(imageFile, apiKey) {
  const formData = new FormData();
  formData.append("images", imageFile);
  formData.append("organs", "auto");
  const res = await fetch(PLANTNET_WORKER_URL, {
    method: "POST",
    headers: { "X-Plantnet-Key": apiKey },
    body: formData,
  });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).message || ""; } catch {}
    if (res.status === 401) throw new Error(`Invalid PlantNet API key. Check your key and try again.${detail ? ` (${detail})` : ""}`);
    if (res.status === 403) throw new Error(`Access denied (403).${detail ? ` PlantNet says: ${detail}` : ""}`);
    if (res.status === 404) throw new Error("No plants identified. Try a clearer photo showing leaves or flowers.");
    throw new Error(`Identification failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  const data = await res.json();
  return data.results || [];
}

function findCatalogMatch(taxon) {
  const common = (taxon.preferred_common_name || "").toLowerCase();
  const sci = (taxon.name || "").toLowerCase();
  return PLANT_TYPES.find((p) => {
    const pn = p.name.toLowerCase();
    return common === pn || common.includes(pn) || pn.includes(common.split(" ")[0]) || sci.startsWith(pn.split(" ")[0]);
  });
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
  // Steps: 'search' | 'searching' | 'results' | 'confirm' | 'manual'
  const [step, setStep] = useState("search");

  // Search state
  const [searchMode, setSearchMode] = useState("text"); // "text" | "photo"
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchError, setSearchError] = useState("");

  // Photo identification state
  const [plantNetKey, setPlantNetKeyState] = useState(() => (localStorage.getItem(PLANTNET_KEY_STORAGE) || "").trim());
  const [plantNetKeyInput, setPlantNetKeyInput] = useState("");
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const photoInputRef = useRef(null);

  useEffect(() => () => { if (photoPreview) URL.revokeObjectURL(photoPreview); }, [photoPreview]);

  // Selected iNaturalist taxon
  const [selectedTaxon, setSelectedTaxon] = useState(null);
  const [catalogMatch, setCatalogMatch] = useState(null);

  // Plant instance fields
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

  const savePlantNetKey = () => {
    const key = plantNetKeyInput.trim();
    if (!key) return;
    localStorage.setItem(PLANTNET_KEY_STORAGE, key);
    setPlantNetKeyState(key);
    setPlantNetKeyInput("");
  };

  const handlePhotoSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const handlePhotoIdentify = async () => {
    if (!photoFile || !plantNetKey) return;
    setSearchError("");
    setStep("searching");
    try {
      const plantNetResults = await identifyWithPlantNet(photoFile, plantNetKey);
      if (!plantNetResults.length) {
        setSearchError("No plants identified. Try a clearer photo.");
        setStep("search");
        return;
      }
      // Cross-reference each PlantNet result with iNaturalist for rich taxon data
      const taxaPromises = plantNetResults.slice(0, 6).map(async (r) => {
        const sciName = r.species?.scientificNameWithoutAuthor || "";
        try {
          const inatResults = await searchINaturalist(sciName);
          if (inatResults.length > 0) return { ...inatResults[0], _plantNetScore: r.score };
        } catch { /* fall through to PlantNet fallback */ }
        const fallbackPhoto = r.images?.[0]?.url?.s;
        if (!fallbackPhoto) return null;
        return {
          id: `pn_${sciName}`,
          name: sciName,
          preferred_common_name: r.species?.commonNames?.[0] || sciName,
          default_photo: { square_url: fallbackPhoto },
          observations_count: 0,
          _plantNetScore: r.score,
        };
      });
      const taxa = (await Promise.all(taxaPromises)).filter(Boolean);
      if (!taxa.length) { setSearchError("Couldn't match photo to plant data. Try a different photo."); setStep("search"); return; }
      setSearchResults(taxa);
      setStep("results");
    } catch (err) {
      setSearchError(err.message);
      setStep("search");
    }
  };

  const handleSearch = async (e) => {
    e?.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    setSearchError("");
    setStep("searching");
    try {
      const results = await searchINaturalist(q);
      if (results.length === 0) {
        setSearchError("No plants found. Try a different name.");
        setStep("search");
        return;
      }
      setSearchResults(results);
      setStep("results");
    } catch (err) {
      setSearchError(err.message);
      setStep("search");
    }
  };

  const handleSelectTaxon = (taxon) => {
    setSelectedTaxon(taxon);
    const commonName = taxon.preferred_common_name || taxon.name;
    setName(commonName);
    const match = findCatalogMatch(taxon);
    setCatalogMatch(match || null);
    if (match) {
      setWateringDays(match.wateringIntervalDays);
      setDifficulty(match.difficulty);
      setLight(match.light);
    }
    setNickname("");
    setLocation("");
    setLastWatered(today);
    setStep("confirm");
  };

  const handleConfirmCatalog = (e) => {
    e.preventDefault();
    onAddCatalog({
      id: Date.now(),
      typeId: catalogMatch.id,
      nickname: nickname.trim() || catalogMatch.name,
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
    if (step === "results") { setStep("search"); setPhotoFile(null); setPhotoPreview(null); }
    else if (step === "confirm") setStep("results");
    else if (step === "manual") setStep("search");
  };

  const canGoBack = ["results", "confirm", "manual"].includes(step);

  const stepTitles = {
    search: "Find Your Plant",
    searching: searchMode === "photo" ? "Identifying…" : "Searching…",
    results: searchMode === "photo" ? "Photo Matches" : `Results for "${searchQuery}"`,
    confirm: selectedTaxon ? (selectedTaxon.preferred_common_name || selectedTaxon.name) : "Confirm",
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

        {/* ── SEARCH STEP ── */}
        {step === "search" && (
          <div className="custom-step">
            <div className="search-mode-tabs">
              <button type="button" className={`mode-tab ${searchMode === "text" ? "mode-tab-active" : ""}`} onClick={() => setSearchMode("text")}>
                🔍 Search by name
              </button>
              <button type="button" className={`mode-tab ${searchMode === "photo" ? "mode-tab-active" : ""}`} onClick={() => setSearchMode("photo")}>
                📷 Upload photo
              </button>
            </div>

            {searchMode === "text" ? (
              <>
                <p className="step-hint">Search iNaturalist's database of millions of plants — browse real community photos to find your species.</p>
                <form onSubmit={handleSearch} className="search-form">
                  <input
                    type="text"
                    className="search-input"
                    placeholder="e.g. Monstera, Snake plant, Fiddle leaf fig…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    autoFocus
                  />
                  {searchError && <div className="identify-error">{searchError}</div>}
                  <div className="modal-actions">
                    <button type="button" className="btn-secondary" onClick={() => setStep("manual")}>Add manually →</button>
                    <button type="submit" className="btn-primary" disabled={!searchQuery.trim()}>🔍 Search</button>
                  </div>
                </form>
              </>
            ) : (
              <div className="photo-identify-pane">
                {!plantNetKey ? (
                  <div className="plantnet-setup">
                    <div className="plantnet-icon">🌿</div>
                    <p className="step-hint">Photo ID uses <strong>PlantNet</strong> — AI trained on millions of plant photos.</p>
                    <p className="step-hint" style={{ marginTop: 0 }}>
                      Get a free API key at <strong>my.plantnet.org</strong>, then paste it below.
                    </p>
                    <div className="sync-input-row" style={{ marginTop: "14px" }}>
                      <input
                        type="text"
                        className="sync-key-input"
                        placeholder="Paste PlantNet API key…"
                        value={plantNetKeyInput}
                        onChange={(e) => setPlantNetKeyInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && savePlantNetKey()}
                        autoFocus
                      />
                      <button type="button" className="btn-primary" onClick={savePlantNetKey} disabled={!plantNetKeyInput.trim()}>Save</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="step-hint">Upload a clear photo of your plant — a leaf, flower, or the whole plant works best.</p>
                    <label
                      className={`photo-drop-zone ${photoPreview ? "photo-drop-zone-filled" : ""}`}
                      tabIndex={0}
                      onKeyDown={(e) => e.key === "Enter" && photoInputRef.current?.click()}
                    >
                      {photoPreview ? (
                        <img src={photoPreview} alt="Plant to identify" className="photo-preview-img" />
                      ) : (
                        <div className="photo-drop-inner">
                          <span className="photo-drop-icon">📷</span>
                          <span className="photo-drop-text">Click to choose a photo</span>
                          <span className="photo-drop-sub">or take one with your camera</span>
                        </div>
                      )}
                      <input ref={photoInputRef} type="file" accept="image/*" onChange={handlePhotoSelect} style={{ display: "none" }} />
                    </label>
                    {searchError && <div className="identify-error">{searchError}</div>}
                    <div className="modal-actions">
                      <button type="button" className="btn-secondary btn-sm" onClick={() => { localStorage.removeItem(PLANTNET_KEY_STORAGE); setPlantNetKeyState(""); }}>
                        Change key
                      </button>
                      <button type="button" className="btn-primary" onClick={handlePhotoIdentify} disabled={!photoFile}>
                        🔍 Identify plant
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── SEARCHING STEP ── */}
        {step === "searching" && (
          <div className="identifying-state">
            <div className="spinner" />
            <p className="identifying-text">{searchMode === "photo" ? "Identifying your plant…" : "Searching iNaturalist…"}</p>
            <p className="identifying-sub">{searchMode === "photo" ? "Powered by PlantNet AI" : "Powered by millions of community observations"}</p>
          </div>
        )}

        {/* ── RESULTS STEP ── */}
        {step === "results" && (
          <div className="custom-step">
            <p className="step-hint">Tap the plant that matches yours to add it.</p>
            <div className="inat-results-grid">
              {searchResults.map((taxon) => (
                <button
                  key={taxon.id}
                  type="button"
                  className="inat-taxon-card"
                  onClick={() => handleSelectTaxon(taxon)}
                >
                  <img
                    src={taxon.default_photo.square_url}
                    alt={taxon.preferred_common_name || taxon.name}
                    className="inat-taxon-photo"
                    loading="lazy"
                  />
                  <div className="inat-taxon-info">
                    <span className="inat-common-name">{taxon.preferred_common_name || taxon.name}</span>
                    <span className="inat-sci-name">{taxon.name}</span>
                    {taxon._plantNetScore != null ? (
                      <span className="inat-obs-count">{Math.round(taxon._plantNetScore * 100)}% match</span>
                    ) : taxon.observations_count > 0 ? (
                      <span className="inat-obs-count">{taxon.observations_count.toLocaleString()} obs.</span>
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
            <button type="button" className="btn-secondary full-width" onClick={() => setStep("manual")}>
              None of these → Add manually
            </button>
          </div>
        )}

        {/* ── CONFIRM STEP ── */}
        {step === "confirm" && selectedTaxon && (
          <div className="custom-step">
            <div className="taxon-confirm-header">
              {selectedTaxon.default_photo && (
                <img
                  src={selectedTaxon.default_photo.square_url}
                  alt={selectedTaxon.preferred_common_name || selectedTaxon.name}
                  className="taxon-confirm-photo"
                />
              )}
              <div className="taxon-confirm-names">
                <span className="taxon-confirm-common">{selectedTaxon.preferred_common_name || selectedTaxon.name}</span>
                <span className="taxon-confirm-sci">{selectedTaxon.name}</span>
                {catalogMatch && <span className="catalog-match-badge">In our catalog</span>}
              </div>
            </div>

            {catalogMatch ? (
              <>
                <div className="confirm-type-card">
                  <span className="confirm-emoji">{catalogMatch.emoji}</span>
                  <div>
                    <div className="confirm-name">{catalogMatch.name}</div>
                    <div className="confirm-meta">
                      {catalogMatch.difficulty} · 💡 {catalogMatch.light} · 💧 Every {catalogMatch.wateringIntervalDays}d
                    </div>
                  </div>
                </div>
                <form onSubmit={handleConfirmCatalog} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  <label>
                    Nickname
                    <input type="text" placeholder={catalogMatch.name} value={nickname} onChange={(e) => setNickname(e.target.value)} />
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
                    <button type="button" className="btn-secondary" onClick={() => setCatalogMatch(null)}>Use custom care info</button>
                    <button type="submit" className="btn-primary">Add Plant ✓</button>
                  </div>
                </form>
              </>
            ) : (
              <form onSubmit={handleSubmitCustom} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div className="emoji-name-row">
                  <label className="emoji-label">
                    Emoji
                    <select className="emoji-select-input" value={emoji} onChange={(e) => setEmoji(e.target.value)}>
                      {PLANT_EMOJIS.map((em) => (
                        <option key={em} value={em}>{em}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ flex: 1 }}>
                    Plant Name *
                    <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
                  </label>
                </div>
                <label>
                  Watering Interval
                  <div className="watering-interval-row">
                    <span>Every</span>
                    <input type="number" min="1" max="90" value={wateringDays} onChange={(e) => setWateringDays(Number(e.target.value))} className="interval-input" />
                    <span>days</span>
                  </div>
                </label>
                <div className="form-field">
                  <span className="form-field-label">Difficulty</span>
                  <div className="difficulty-btns">
                    {["Easy", "Moderate", "Hard"].map((d) => (
                      <button type="button" key={d} className={`diff-btn ${difficulty === d ? "active" : ""}`} onClick={() => setDifficulty(d)}
                        style={difficulty === d ? { background: getDifficultyColor(d), color: "white", borderColor: getDifficultyColor(d) } : {}}>
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
                <label>
                  Light Requirements
                  <input type="text" placeholder="e.g. Bright indirect" value={light} onChange={(e) => setLight(e.target.value)} />
                </label>
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
            )}
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

function SyncModal({ syncKey, syncStatus, onCreateSync, onConnectSync, onDisconnect, onClose }) {
  const [inputKey, setInputKey] = useState("");
  const [copied, setCopied] = useState(false);

  const copyKey = () => {
    navigator.clipboard.writeText(syncKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const statusLabel = { idle: "", syncing: "Syncing…", synced: "Synced ✓", error: "Sync error" }[syncStatus] || "";
  const statusClass = { syncing: "sync-status-syncing", synced: "sync-status-ok", error: "sync-status-error" }[syncStatus] || "";

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-content sync-modal">
        <button className="modal-close" onClick={onClose}>×</button>
        <h2 className="modal-title">☁ Cloud Sync</h2>
        <p className="sync-desc">Keep your plant data in sync across multiple browsers or devices using a unique sync key.</p>

        {syncKey ? (
          <div className="sync-connected">
            <div className="sync-key-row">
              <div>
                <div className="sync-label">Your sync key</div>
                <code className="sync-key-value">{syncKey}</code>
              </div>
              <button className="btn-secondary btn-sm" onClick={copyKey}>{copied ? "Copied!" : "Copy"}</button>
            </div>
            {statusLabel && <div className={`sync-status-badge ${statusClass}`}>{statusLabel}</div>}
            <p className="sync-hint">Use this key on any other device to connect to the same data. Changes sync automatically within a few seconds.</p>
            <button className="btn-danger btn-sm sync-disconnect" onClick={onDisconnect}>Disconnect sync</button>
          </div>
        ) : (
          <div className="sync-setup">
            <div className="sync-option">
              <h3>Start fresh sync</h3>
              <p>Create a new sync key linked to your current plants.</p>
              <button className="btn-primary" onClick={onCreateSync} disabled={syncStatus === "syncing"}>
                {syncStatus === "syncing" ? "Creating…" : "Create sync key"}
              </button>
            </div>
            <div className="sync-divider">or</div>
            <div className="sync-option">
              <h3>Connect to existing key</h3>
              <p>Enter a sync key from another device to load and share its data.</p>
              <div className="sync-input-row">
                <input
                  className="sync-key-input"
                  type="text"
                  placeholder="Paste sync key…"
                  value={inputKey}
                  onChange={(e) => setInputKey(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && inputKey.trim() && onConnectSync(inputKey)}
                />
                <button
                  className="btn-secondary"
                  onClick={() => onConnectSync(inputKey)}
                  disabled={!inputKey.trim() || syncStatus === "syncing"}
                >
                  {syncStatus === "syncing" ? "Connecting…" : "Connect"}
                </button>
              </div>
              {syncStatus === "error" && <div className="sync-status-badge sync-status-error">Connection failed — check the key</div>}
            </div>
          </div>
        )}
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
  const [showDataMenu, setShowDataMenu] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncKey, setSyncKeyState] = useState(() => localStorage.getItem(SYNC_KEY_STORAGE) || "");
  const [syncStatus, setSyncStatus] = useState("idle");
  const importRef = useRef(null);
  const syncTimer = useRef(null);

  const setSyncKey = useCallback((key) => {
    setSyncKeyState(key);
    if (key) localStorage.setItem(SYNC_KEY_STORAGE, key);
    else localStorage.removeItem(SYNC_KEY_STORAGE);
  }, []);

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(plants)); }, [plants]);
  useEffect(() => { localStorage.setItem(CUSTOM_TYPES_KEY, JSON.stringify(customTypes)); }, [customTypes]);

  // Fetch remote data on mount if synced
  useEffect(() => {
    if (!syncKey) return;
    setSyncStatus("syncing");
    readSyncBlob(syncKey)
      .then((data) => {
        if (Array.isArray(data.plants)) setPlants(data.plants);
        if (Array.isArray(data.customTypes)) setCustomTypes(data.customTypes);
        setSyncStatus("synced");
      })
      .catch(() => setSyncStatus("error"));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-push to remote 2s after any change
  useEffect(() => {
    if (!syncKey) return;
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      setSyncStatus("syncing");
      writeSyncBlob(syncKey, { version: 1, plants, customTypes })
        .then(() => setSyncStatus("synced"))
        .catch(() => setSyncStatus("error"));
    }, 2000);
    return () => clearTimeout(syncTimer.current);
  }, [plants, customTypes, syncKey]);

  useEffect(() => {
    if (!showDataMenu) return;
    const close = (e) => { if (!e.target.closest(".data-menu-wrap")) setShowDataMenu(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [showDataMenu]);

  const handleCreateSync = useCallback(async () => {
    setSyncStatus("syncing");
    try {
      const id = await createSyncBlob({ version: 1, plants, customTypes });
      setSyncKey(id);
      setSyncStatus("synced");
    } catch {
      setSyncStatus("error");
      alert("Failed to create sync. Check your internet connection.");
    }
  }, [plants, customTypes, setSyncKey]);

  const handleConnectSync = useCallback(async (inputKey) => {
    const key = inputKey.trim();
    if (!/^\d+$/.test(key)) { alert("Invalid sync key — it should be a number."); return; }
    setSyncStatus("syncing");
    try {
      const data = await readSyncBlob(key);
      if (!Array.isArray(data.plants)) throw new Error("Invalid data");
      if (plants.length > 0 && !window.confirm(
        `Connect to sync?\n\nThis will replace your ${plants.length} local plant${plants.length !== 1 ? "s" : ""} with the synced data.`
      )) { setSyncStatus("idle"); return; }
      setPlants(data.plants);
      setCustomTypes(Array.isArray(data.customTypes) ? data.customTypes : []);
      setSyncKey(key);
      setSyncStatus("synced");
    } catch (err) {
      setSyncStatus("error");
      alert(err.message === "Sync key not found" ? "Sync key not found." : "Connection failed. Check the key and your internet.");
    }
  }, [plants.length, setSyncKey]);

  const handleDisconnectSync = useCallback(() => {
    if (!window.confirm("Stop syncing? Your local data will be kept but changes won't sync to other devices.")) return;
    setSyncKey("");
    setSyncStatus("idle");
    setShowSyncModal(false);
  }, [setSyncKey]);

  const handleExport = useCallback(() => {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      plants,
      customTypes,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `plant-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setShowDataMenu(false);
  }, [plants, customTypes]);

  const handleImportFile = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!Array.isArray(data.plants)) throw new Error("Invalid backup file.");
        const importedPlants = data.plants.length;
        if (!window.confirm(
          `Import ${importedPlants} plant${importedPlants !== 1 ? "s" : ""} from backup?\n\nThis will replace your current collection.`
        )) return;
        setPlants(data.plants);
        setCustomTypes(Array.isArray(data.customTypes) ? data.customTypes : []);
      } catch {
        alert("Could not read backup file. Make sure it's a valid Plant Tracker export.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
    setShowDataMenu(false);
  }, []);

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
            <div className="data-menu-wrap">
              <button
                className="btn-data-header"
                onClick={() => setShowDataMenu((v) => !v)}
                title="Data options"
              >
                💾{syncKey && <span className={`sync-dot ${syncStatus === "synced" ? "sync-dot-ok" : syncStatus === "syncing" ? "sync-dot-syncing" : syncStatus === "error" ? "sync-dot-error" : ""}`} />}
              </button>
              {showDataMenu && (
                <div className="data-menu" role="menu">
                  <button className="data-menu-item" onClick={() => { setShowDataMenu(false); setShowSyncModal(true); }}>
                    ☁ {syncKey ? (syncStatus === "synced" ? "Synced ✓" : syncStatus === "error" ? "Sync error ⚠" : "Syncing…") : "Set up sync"}
                  </button>
                  <button className="data-menu-item" onClick={handleExport}>⬇ Export backup</button>
                  <button className="data-menu-item" onClick={() => importRef.current?.click()}>⬆ Import backup</button>
                </div>
              )}
            </div>
            <input ref={importRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={handleImportFile} />
            <button className="btn-identify-header" onClick={() => setShowCustom(true)}>
              🔍 Find a Plant
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
              <button className="btn-secondary btn-large" onClick={() => setShowCustom(true)}>🔍 Find a Plant</button>
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

      {showSyncModal && (
        <SyncModal
          syncKey={syncKey}
          syncStatus={syncStatus}
          onCreateSync={handleCreateSync}
          onConnectSync={handleConnectSync}
          onDisconnect={handleDisconnectSync}
          onClose={() => setShowSyncModal(false)}
        />
      )}
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
