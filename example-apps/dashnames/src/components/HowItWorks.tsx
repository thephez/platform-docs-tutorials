/**
 * Static explainer — what the app demonstrates and where it deviates from a
 * production marketplace.
 */
export function HowItWorks() {
  return (
    <div className="prose">
      <h2>What this app demonstrates</h2>
      <p>
        Dash Platform 4.1 / protocol v13 unblocked <code>transfer</code>,{" "}
        <code>priceUpdate</code>, and <code>purchase</code> on DPNS{" "}
        <code>domain</code> documents. The DPNS contract always declared{" "}
        <code>transferable: 1</code> and <code>tradeMode: 1</code>, but a
        hardcoded reject trigger blocked those transitions until v13. Names can
        now be listed and sold on-chain.
      </p>

      <h2>Finding what is for sale</h2>
      <p>
        <code>$price</code> is not an indexed property on <code>domain</code>,
        so Platform cannot answer "which names are for sale" — a{" "}
        <code>where</code> clause on it is rejected outright. Instead this app
        reads the Document History system contract, which records every price
        change, sale, and transfer since v13.
      </p>
      <h3>The algorithm</h3>
      <p>
        Page every <code>priceUpdate</code> for the DPNS contract; keep each
        document that has ever had a <em>positive</em> price; then batch-fetch
        those documents by <code>$id</code> (100 at a time, the maximum) and
        keep only the ones that still carry a positive <code>$price</code>.
      </p>
      <p>
        History nominates candidates; the current document decides. That is what
        makes the index correct across delisting, purchase, transfer, and
        repricing without special-casing any of them.
      </p>

      <h2>Honest limits</h2>
      <p>
        This client scans history itself, which a production marketplace would
        delegate to a server-side indexer. Two costs grow forever: the history
        replay, and the batch-fetch of every name that was <em>ever</em> listed.
        A browser normally pays that once per profile, but it is the real
        ceiling of the approach.
      </p>
      <p>
        Fee estimates are not shown, because the SDK has no fee-estimation or
        dry-run method — any figure would be invented. Affordability is checked
        against the asking price, and Platform rejects a genuinely insufficient
        balance.
      </p>
      <p>
        Registering a new name is out of scope: it needs the preorder/commit
        flow and contested-name voting. Register with the repo's{" "}
        <code>name-register.mjs</code> tutorial, then list the name here.
      </p>

      <h2>Before you buy</h2>
      <p>
        The buy dialog re-fetches the document when it opens, again when the
        quote expires, and once more immediately before signing. If the price,
        revision, or owner moved, it stops and shows the difference rather than
        submitting.
      </p>
    </div>
  );
}
