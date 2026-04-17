import re

with open("components/SongEditModal.tsx", "r") as f:
    content = f.read()

# We need to replace the content inside the "loadingSong ? ... : (<> ... </>)"
# Let's use string find and slice instead of regex to be precise

start_str = "              ) : (\n                <>\n                  <section className=\"rounded-[10px] border border-[var(--color-border)] bg-white/4 p-4\">"
end_str = "                  </section>\n                </>\n              )}\n\n              <AnimatePresence>"

start_idx = content.find(start_str)
end_idx = content.find(end_str) + len("                  </section>\n                </>\n              )}")

if start_idx == -1 or end_idx < start_idx:
    print("Could not find the target strings.")
    exit(1)

new_content = """              ) : (
                <div className="relative mt-2 border-l border-[var(--color-border-strong)] ml-4 md:ml-6 space-y-8 pb-4">
                  {/* PDF Section */}
                  <article className="relative pl-6">
                    <div className="absolute -left-[17px] top-0 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-surface-solid)] border border-[var(--color-border-strong)] shadow-sm">
                      <FileText size={14} className="text-[var(--color-accent)]" />
                    </div>

                    <input
                      ref={pdfInputRef}
                      type="file"
                      accept=".pdf"
                      className="hidden"
                      onChange={handlePdfPicked}
                    />

                    <div className="space-y-3 pt-0.5">
                      {activeSheet ? (
                        <div className="group flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-[var(--color-text-high)]">
                              {activeSheet.file_name}
                            </p>
                            <p className="mt-0.5 text-xs text-[var(--color-text-medium)]">
                              {formatFileSize(activeSheet.file_size_bytes)}
                            </p>
                          </div>
                          <div className="flex flex-shrink-0 items-center gap-1.5 opacity-100 sm:opacity-0 focus-within:opacity-100 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={() => pdfInputRef.current?.click()}
                              disabled={uploadingPdf || deletingFileId === activeSheet.id}
                              className="flex h-7 w-7 items-center justify-center rounded-full bg-white/5 text-[var(--color-text-medium)] hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent)] disabled:opacity-45"
                              title="PDF Değiştir"
                            >
                              {uploadingPdf ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                            </button>
                            <button
                              type="button"
                              onClick={handleDeletePdf}
                              disabled={uploadingPdf || deletingFileId === activeSheet.id}
                              className="flex h-7 w-7 items-center justify-center rounded-full bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-45"
                              title="PDF Sil"
                            >
                              {deletingFileId === activeSheet.id ? (
                                <Loader2 size={13} className="animate-spin" />
                              ) : (
                                <Trash2 size={13} />
                              )}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between">
                          <p className="text-sm text-[var(--color-text-medium)]">Henüz nota PDF'i yok.</p>
                          <button
                            type="button"
                            onClick={() => pdfInputRef.current?.click()}
                            disabled={uploadingPdf}
                            className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)] disabled:opacity-45"
                            title="PDF Yükle"
                          >
                            {uploadingPdf ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                          </button>
                        </div>
                      )}
                    </div>
                  </article>

                  {/* MP3 Section */}
                  <article className="relative pl-6">
                    <div className="absolute -left-[17px] top-0 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-surface-solid)] border border-[var(--color-border-strong)] shadow-sm">
                      <Mic size={14} className="text-[var(--color-accent)]" />
                    </div>

                    <div className="space-y-4 pt-0.5">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={audioLabel}
                          onChange={(event) => setAudioLabel(event.target.value)}
                          placeholder="Etiket (Örn: Bass)"
                          className="editorial-input h-8 flex-1 !text-sm"
                        />
                        <input
                          ref={audioInputRef}
                          type="file"
                          accept=".mp3"
                          className="hidden"
                          onChange={handleAudioFileSelect}
                        />
                        <button
                          type="button"
                          onClick={() => audioInputRef.current?.click()}
                          className="flex h-8 items-center justify-center gap-1.5 rounded-[8px] bg-white/5 px-2.5 text-xs font-medium text-[var(--color-text-medium)] hover:text-white transition-colors"
                          title="Dosya Seç"
                        >
                          <Upload size={13} />
                          <span className="max-w-[70px] truncate">
                            {audioFile ? audioFile.name : 'Seç'}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={handleAddAudio}
                          disabled={uploadingAudio || !audioFile || !audioLabel.trim()}
                          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)] disabled:opacity-45"
                          title="MP3 Ekle"
                        >
                          {uploadingAudio ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                        </button>
                      </div>

                      <div className="space-y-3">
                        {audioFiles.length === 0 ? (
                          <p className="text-sm text-[var(--color-text-medium)]">Henüz MP3 kanalı yok.</p>
                        ) : (
                          audioFiles.map((file) => {
                            const replacing = replacingAudioId === file.id;
                            const deleting = deletingFileId === file.id;

                            return (
                              <div key={file.id} className="group flex items-center justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-semibold text-[var(--color-text-high)]">
                                    {getAudioLabel(file)}
                                  </p>
                                  <p className="truncate text-xs text-[var(--color-text-medium)]">
                                    {file.file_name}
                                    {file.file_size_bytes ? ` · ${formatFileSize(file.file_size_bytes)}` : ''}
                                  </p>
                                </div>

                                <input
                                  ref={(node) => {
                                    replaceInputRefs.current[file.id] = node;
                                  }}
                                  type="file"
                                  accept=".mp3"
                                  className="hidden"
                                  onChange={(event) => {
                                    const picked = event.target.files?.[0];
                                    event.target.value = '';
                                    if (picked) {
                                      void handleReplaceAudio(file, picked);
                                    }
                                  }}
                                />

                                <div className="flex flex-shrink-0 items-center gap-1.5 opacity-100 sm:opacity-0 focus-within:opacity-100 group-hover:opacity-100 transition-opacity">
                                  <button
                                    type="button"
                                    onClick={() => replaceInputRefs.current[file.id]?.click()}
                                    disabled={replacing || deleting}
                                    className="flex h-7 w-7 items-center justify-center rounded-full bg-white/5 text-[var(--color-text-medium)] hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent)] disabled:opacity-45"
                                    title="Değiştir"
                                  >
                                    {replacing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleDeleteAudio(file)}
                                    disabled={replacing || deleting}
                                    className="flex h-7 w-7 items-center justify-center rounded-full bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-45"
                                    title="Sil"
                                  >
                                    {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </article>

                  {/* Tags Section */}
                  <article className="relative pl-6">
                    <div className="absolute -left-[17px] top-0 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-surface-solid)] border border-[var(--color-border-strong)] shadow-sm">
                      <Tag size={14} className="text-[var(--color-accent)]" />
                    </div>

                    <div className="space-y-4 pt-0.5">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={newTagName}
                          onChange={(event) => setNewTagName(event.target.value)}
                          placeholder="Yeni etiket adı"
                          className="editorial-input h-8 flex-1 !text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => void handleCreateTag()}
                          disabled={creatingTag || !newTagName.trim()}
                          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)] disabled:opacity-45"
                          title="Etiket Oluştur"
                        >
                          {creatingTag ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                        </button>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {availableTags.length === 0 ? (
                          <p className="text-sm text-[var(--color-text-medium)]">Bölümde etiket bulunamadı.</p>
                        ) : (
                          availableTags.map((tag) => {
                            const active = selectedTagIds.has(tag.id);
                            const saving = savingTagId === tag.id;
                            return (
                              <button
                                key={tag.id}
                                type="button"
                                onClick={() => void handleToggleTag(tag)}
                                disabled={saving}
                                className={`inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-[0.6rem] font-semibold transition-colors ${
                                  active
                                    ? 'bg-[rgba(192,178,131,0.15)] text-[var(--color-accent)]'
                                    : 'bg-white/5 text-[var(--color-text-medium)] hover:bg-white/10'
                                } disabled:opacity-45`}
                              >
                                {saving ? <Loader2 size={10} className="animate-spin" /> : active ? <Check size={10} /> : <Tag size={10} />}
                                {tag.name}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </article>
                </div>
              )}"""

merged = content[:start_idx] + new_content + content[end_idx:]

with open("components/SongEditModal.tsx", "w") as f:
    f.write(merged)

print("Patch applied successfully.")
