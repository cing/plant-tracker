import { useState, useEffect } from "react";
import { PLANT_TYPES, getDifficultyColor, getWateringStatus } from "./plantData";
import "./App.css";

function AddPlantModal({ onAdd, onClose }) {
  const [selectedType, setSelectedType] = useState("");
  const [nickname, setNickname] = useState("");
  const [location, setLocation] = useState("");
  const [lastWatered, setLastWatered] = useState(new Date().toISOString().split("T")[0]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!selectedType) return;
    const type = PLANT_TYPES.find((p) => p.id === selectedType);
    onAdd({
      id: Date.now(),
      typeId: selectedType,
      nickname: nickname || type.name,
      location,
      lastWatered,
    });
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
                <option key={p.id} value={p.id}>
                  {p.emoji} {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Nickname
            <input
              type="text"
              placeholder="e.g. Living Room Monstera"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
            />
          </label>
          <label>
            Location
            <input
              type="text"
              placeholder="e.g. Kitchen windowsill"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </label>
          <label>
            Last Watered
            <input
              type="date"
              value={lastWatered}
              max={new Date().toISOString().split("T")[0]}
              onChange={(e) => setLastWatered(e.target.value)}
            />
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

function TipsModal({ plant, plantType, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal tips-modal" onClick={(e) => e.stopPropagation()}>
        <div className="tips-header">
          <span className="tips-emoji">{plantType.emoji}</span>
          <div>
            <h2>{plant.nickname}</h2>
            <p className="tips-type">{plantType.name}</p>
          </div>
        </div>
        <div className="tips-meta">
          <span className="meta-badge" style={{ background: getDifficultyColor(plantType.difficulty) + "22", color: getDifficultyColor(plantType.difficulty) }}>
            {plantType.difficulty}
          </span>
          <span className="meta-badge light-badge">
            💡 {plantType.light}
          </span>
          <span className="meta-badge water-badge">
            💧 Every {plantType.wateringIntervalDays}d
          </span>
        </div>
        <h3>Care Tips</h3>
        <ul className="tips-list">
          {plantType.tips.map((tip, i) => (
            <li key={i}>{tip}</li>
          ))}
        </ul>
        <button className="btn-primary full-width" onClick={onClose}>Got it!</button>
      </div>
    </div>
  );
}

function PlantCard({ plant, plantType, onWater, onDelete, onShowTips }) {
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
          <p className="plant-type">{plantType.name}</p>
          {plant.location && <p className="plant-location">📍 {plant.location}</p>}
        </div>
        <button className="btn-icon delete-btn" onClick={() => onDelete(plant.id)} title="Remove plant">✕</button>
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
        <button className="btn-water" onClick={() => onWater(plant.id)}>
          💧 Water now
        </button>
        <button className="btn-tips" onClick={() => onShowTips(plant)}>
          🌿 Care tips
        </button>
      </div>
    </div>
  );
}

function SortBar({ sort, setSort, filter, setFilter }) {
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
          <button
            key={f.key}
            className={`filter-btn ${filter === f.key ? "active" : ""}`}
            onClick={() => setFilter(f.key)}
          >
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
    </div>
  );
}

const STORAGE_KEY = "plant-tracker-plants-v1";
const STATUS_ORDER = { overdue: 0, today: 1, soon: 2, ok: 3, unknown: 4 };

export default function App() {
  const [plants, setPlants] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [showAdd, setShowAdd] = useState(false);
  const [tipsPlant, setTipsPlant] = useState(null);
  const [sort, setSort] = useState("urgency");
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plants));
  }, [plants]);

  const addPlant = (plant) => setPlants((prev) => [...prev, plant]);
  const deletePlant = (id) => setPlants((prev) => prev.filter((p) => p.id !== id));
  const waterPlant = (id) =>
    setPlants((prev) =>
      prev.map((p) => (p.id === id ? { ...p, lastWatered: new Date().toISOString().split("T")[0] } : p))
    );

  const getType = (typeId) => PLANT_TYPES.find((t) => t.id === typeId);

  const enriched = plants.map((p) => {
    const type = getType(p.typeId);
    const status = getWateringStatus(p.lastWatered, type.wateringIntervalDays);
    return { plant: p, type, status };
  });

  const needsWater = enriched.filter(({ status }) => status.status === "overdue" || status.status === "today").length;

  const filtered = enriched.filter(({ status }) => filter === "all" || status.status === filter);

  const sorted = [...filtered].sort((a, b) => {
    if (sort === "urgency")
      return (STATUS_ORDER[a.status.status] - STATUS_ORDER[b.status.status]) ||
        (a.status.daysUntil ?? 999) - (b.status.daysUntil ?? 999);
    if (sort === "name") return a.plant.nickname.localeCompare(b.plant.nickname);
    if (sort === "type") return a.type.name.localeCompare(b.type.name);
    return 0;
  });

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
          <button className="btn-primary btn-add-header" onClick={() => setShowAdd(true)}>
            + Add Plant
          </button>
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
            <button className="btn-primary btn-large" onClick={() => setShowAdd(true)}>
              + Add your first plant
            </button>
          </div>
        ) : (
          <>
            <div className="plant-summary">
              <span>{plants.length} plant{plants.length !== 1 ? "s" : ""} in your home</span>
            </div>
            <SortBar sort={sort} setSort={setSort} filter={filter} setFilter={setFilter} />
            {sorted.length === 0 ? (
              <div className="empty-filter">No plants match this filter.</div>
            ) : (
              <div className="plant-grid">
                {sorted.map(({ plant, type }) => (
                  <PlantCard
                    key={plant.id}
                    plant={plant}
                    plantType={type}
                    onWater={waterPlant}
                    onDelete={deletePlant}
                    onShowTips={setTipsPlant}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {showAdd && <AddPlantModal onAdd={addPlant} onClose={() => setShowAdd(false)} />}
      {tipsPlant && (
        <TipsModal
          plant={tipsPlant}
          plantType={getType(tipsPlant.typeId)}
          onClose={() => setTipsPlant(null)}
        />
      )}
    </div>
  );
}
