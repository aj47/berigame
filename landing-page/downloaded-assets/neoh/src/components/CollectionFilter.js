import { useState } from "react";
const CollectionFilter = () => {
  const [type, setType] = useState(true);
  const [special, setSpecial] = useState(true);
  const [clothing, setClothing] = useState(false);
  const [hair, setHair] = useState(false);
  const [face, setFace] = useState(false);
  const [eyes, setEyes] = useState(false);
  const [mouth, setMouth] = useState(false);
  const [neck, setNeck] = useState(false);
  return (
    <div className="neoh_fn_filters">
      {/* Type */}
      <div className={`filter_item filter__type ${type ? "" : "closed"}`}>
        {/* Filter Header */}
        <div className="filter_item__header c-pointer">
          <a className="full_link" onClick={() => setType(!type)} />
          <span className="text">Type</span>
          <span className="icon">
            <img src="svg/down.svg" alt="" className="fn__svg" />
          </span>
        </div>
        {/* !Filter Header */}
        {/* Filter Content */}
        <div className="filter_item__content">
          <div className="ic_in">
            <ul className="items">
              <li>
                <div className="item">
                  <label className="checkbox" data-category="Type" data-id={1}>
                    <span className="text">Human</span>
                    <span className="amount"> - 3100</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label className="checkbox" data-category="Type" data-id={2}>
                    <span className="text">Spirit</span>
                    <span className="amount"> - 4764</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label className="checkbox" data-category="Type" data-id={3}>
                    <span className="text">Fire</span>
                    <span className="amount"> - 1280</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label className="checkbox" data-category="Type" data-id={4}>
                    <span className="text">Sand</span>
                    <span className="amount"> - 2716</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
            </ul>
          </div>
        </div>
        {/* Filter Content */}
      </div>
      {/* !Type */}
      {/* Special */}
      <div className={`filter_item filter__special ${special ? "" : "closed"}`}>
        {/* Filter Header */}
        <div className="filter_item__header">
          <a
            className="full_link c-pointer"
            onClick={() => setSpecial(!special)}
          />
          <span className="text">Special</span>
          <span className="icon">
            <img src="svg/down.svg" alt="" className="fn__svg" />
          </span>
        </div>
        {/* !Filter Header */}
        {/* Filter Content */}
        <div className="filter_item__content">
          <div className="ic_in">
            <ul className="items">
              <li>
                <div className="item">
                  <label
                    className="checkbox"
                    data-category="Special"
                    data-id={5}
                  >
                    <span className="text">Fireflies</span>
                    <span className="amount"> - 3100</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label
                    className="checkbox"
                    data-category="Special"
                    data-id={6}
                  >
                    <span className="text">Butterfly</span>
                    <span className="amount"> - 4764</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label
                    className="checkbox"
                    data-category="Special"
                    data-id={7}
                  >
                    <span className="text">Fox Fire</span>
                    <span className="amount"> - 1280</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label
                    className="checkbox"
                    data-category="Special"
                    data-id={8}
                  >
                    <span className="text">Smoke</span>
                    <span className="amount"> - 2716</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label
                    className="checkbox"
                    data-category="Special"
                    data-id={9}
                  >
                    <span className="text">Sakura</span>
                    <span className="amount"> - 1280</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label
                    className="checkbox"
                    data-category="Special"
                    data-id={10}
                  >
                    <span className="text">Fire</span>
                    <span className="amount"> - 2716</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label
                    className="checkbox"
                    data-category="Special"
                    data-id={11}
                  >
                    <span className="text">Earth</span>
                    <span className="amount"> - 1534</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label
                    className="checkbox"
                    data-category="Special"
                    data-id={12}
                  >
                    <span className="text">Water</span>
                    <span className="amount"> - 1235</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
            </ul>
          </div>
        </div>
        {/* Filter Content */}
      </div>
      {/* !Special */}
      {/* Clothing */}
      <div
        className={`filter_item filter__clothing ${clothing ? "" : "closed"}`}
      >
        {/* Filter Header */}
        <div className="filter_item__header">
          <a
            className="full_link c-pointer"
            onClick={() => setClothing(!clothing)}
          />
          <span className="text">Clothing</span>
          <span className="icon">
            <img src="svg/down.svg" alt="" className="fn__svg" />
          </span>
        </div>
        {/* !Filter Header */}
        {/* Filter Content */}
        <div className="filter_item__content">
          <div className="ic_in">
            <ul className="items">
              <li>
                <div className="item">
                  <label
                    className="checkbox"
                    data-category="Clothing"
                    data-id={13}
                  >
                    <span className="text">Light Kimono</span>
                    <span className="amount">- 3100</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label
                    className="checkbox"
                    data-category="Clothing"
                    data-id={14}
                  >
                    <span className="text">Maroon Yukata</span>
                    <span className="amount"> - 4764</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label
                    className="checkbox"
                    data-category="Clothing"
                    data-id={15}
                  >
                    <span className="text">Blue Kimono</span>
                    <span className="amount"> - 1280</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label
                    className="checkbox"
                    data-category="Clothing"
                    data-id={16}
                  >
                    <span className="text">Green Yukata</span>
                    <span className="amount"> - 2716</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label
                    className="checkbox"
                    data-category="Clothing"
                    data-id={17}
                  >
                    <span className="text">Turquoise Kimono</span>
                    <span className="amount"> - 1280</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label
                    className="checkbox"
                    data-category="Clothing"
                    data-id={18}
                  >
                    <span className="text">Black Yukata</span>
                    <span className="amount"> - 2716</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label
                    className="checkbox"
                    data-category="Clothing"
                    data-id={19}
                  >
                    <span className="text">Azuki Tech Jacket</span>
                    <span className="amount"> - 1534</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label
                    className="checkbox"
                    data-category="Clothing"
                    data-id={20}
                  >
                    <span className="text">Blue Floral Kimono</span>
                    <span className="amount"> - 1235</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
            </ul>
          </div>
        </div>
        {/* Filter Content */}
      </div>
      {/* !Clothing */}
      {/* Hair */}
      <div className={`filter_item filter__hair ${hair ? "" : "closed"}`}>
        {/* Filter Header */}
        <div className="filter_item__header">
          <a className="full_link c-pointer" onClick={() => setHair(!hair)} />
          <span className="text">Hair</span>
          <span className="icon">
            <img src="svg/down.svg" alt="" className="fn__svg" />
          </span>
        </div>
        {/* !Filter Header */}
        {/* Filter Content */}
        <div className="filter_item__content">
          <div className="ic_in">
            <ul className="items">
              <li>
                <div className="item">
                  <label className="checkbox" data-category="Hair" data-id={21}>
                    <span className="text">Maroon Bun</span>
                    <span className="amount"> - 3100</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label className="checkbox" data-category="Hair" data-id={22}>
                    <span className="text">Maroon Ponytail</span>
                    <span className="amount"> - 4764</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label className="checkbox" data-category="Hair" data-id={23}>
                    <span className="text">Brown Spiky</span>
                    <span className="amount"> - 1280</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label className="checkbox" data-category="Hair" data-id={24}>
                    <span className="text">Brown Long</span>
                    <span className="amount"> - 2716</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label className="checkbox" data-category="Hair" data-id={25}>
                    <span className="text">Maroon Disheveled</span>
                    <span className="amount"> - 1280</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label className="checkbox" data-category="Hair" data-id={26}>
                    <span className="text">Maroon Bob</span>
                    <span className="amount"> - 2716</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label className="checkbox" data-category="Hair" data-id={27}>
                    <span className="text">Magenta Long</span>
                    <span className="amount"> - 1534</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label className="checkbox" data-category="Hair" data-id={28}>
                    <span className="text">Indigo Long</span>
                    <span className="amount"> - 1235</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label className="checkbox" data-category="Hair" data-id={29}>
                    <span className="text">Maroon Short Spiky</span>
                    <span className="amount"> - 345</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label className="checkbox" data-category="Hair" data-id={30}>
                    <span className="text">Blonde Short Spiky</span>
                    <span className="amount"> - 600</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
            </ul>
          </div>
        </div>
        {/* Filter Content */}
      </div>
      {/* !Hair */}
      {/* Face */}
      <div className={`filter_item filter__face ${face ? "" : "closed"}`}>
        {/* Filter Header */}
        <div className="filter_item__header">
          <a className="full_link c-pointer" onClick={() => setFace(!face)} />
          <span className="text">Face</span>
          <span className="icon">
            <img src="svg/down.svg" alt="" className="fn__svg" />
          </span>
        </div>
        {/* !Filter Header */}
        {/* Filter Content */}
        <div className="filter_item__content">
          <div className="ic_in">
            <ul className="items">
              <li>
                <div className="item">
                  <label className="checkbox" data-category="Face" data-id={31}>
                    <span className="text">Red Stripes Face Paint</span>
                    <span className="amount"> - 3100</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label className="checkbox" data-category="Face" data-id={32}>
                    <span className="text">Eye Scar</span>
                    <span className="amount"> - 4764</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label className="checkbox" data-category="Face" data-id={33}>
                    <span className="text">Round Blue Sunglasses</span>
                    <span className="amount"> - 1280</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label className="checkbox" data-category="Face" data-id={34}>
                    <span className="text">Red Fang Face Paint</span>
                    <span className="amount"> - 2716</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label className="checkbox" data-category="Face" data-id={35}>
                    <span className="text">Maroon Disheveled</span>
                    <span className="amount"> - 1280</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
            </ul>
          </div>
        </div>
        {/* Filter Content */}
      </div>
      {/* !Face */}
      {/* Eyes */}
      <div className={`filter_item filter__eyes ${eyes ? "" : "closed"}`}>
        {/* Filter Header */}
        <div className="filter_item__header">
          <a className="full_link c-pointer" onClick={() => setEyes(!eyes)} />
          <span className="text">Eyes</span>
          <span className="icon">
            <img src="svg/down.svg" alt="" className="fn__svg" />
          </span>
        </div>
        {/* !Filter Header */}
        {/* Filter Content */}
        <div className="filter_item__content">
          <div className="ic_in">
            <ul className="items">
              <li>
                <div className="item">
                  <label className="checkbox" data-category="Eyes" data-id={36}>
                    <span className="text">Closed</span>
                    <span className="amount"> - 3100</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label className="checkbox" data-category="Eyes" data-id={37}>
                    <span className="text">Determined</span>
                    <span className="amount"> - 4764</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label className="checkbox" data-category="Eyes" data-id={38}>
                    <span className="text">Striking</span>
                    <span className="amount"> - 1280</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label className="checkbox" data-category="Eyes" data-id={39}>
                    <span className="text">Chill</span>
                    <span className="amount"> - 2716</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label className="checkbox" data-category="Eyes" data-id={40}>
                    <span className="text">Daydreaming</span>
                    <span className="amount"> - 1280</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
            </ul>
          </div>
        </div>
        {/* Filter Content */}
      </div>
      {/* !Eyes */}
      {/* Mouth */}
      <div className={`filter_item filter__mouth ${mouth ? "" : "closed"}`}>
        {/* Filter Header */}
        <div className="filter_item__header">
          <a className="full_link c-pointer" onClick={() => setMouth(!mouth)} />
          <span className="text">Mouth</span>
          <span className="icon">
            <img src="svg/down.svg" alt="" className="fn__svg" />
          </span>
        </div>
        {/* !Filter Header */}
        {/* Filter Content */}
        <div className="filter_item__content">
          <div className="ic_in">
            <ul className="items">
              <li>
                <div className="item">
                  <label
                    className="checkbox"
                    data-category="Mouth"
                    data-id={41}
                  >
                    <span className="text">Relaxed</span>
                    <span className="amount"> - 3100</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label
                    className="checkbox"
                    data-category="Mouth"
                    data-id={42}
                  >
                    <span className="text">Closed</span>
                    <span className="amount"> - 4764</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label
                    className="checkbox"
                    data-category="Mouth"
                    data-id={43}
                  >
                    <span className="text">Smirk</span>
                    <span className="amount"> - 1280</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label
                    className="checkbox"
                    data-category="Mouth"
                    data-id={44}
                  >
                    <span className="text">Not Bad</span>
                    <span className="amount"> - 2716</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label
                    className="checkbox"
                    data-category="Mouth"
                    data-id={45}
                  >
                    <span className="text">Smoking</span>
                    <span className="amount"> - 1280</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label
                    className="checkbox"
                    data-category="Mouth"
                    data-id={46}
                  >
                    <span className="text">Lipstick</span>
                    <span className="amount"> - 490</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
            </ul>
          </div>
        </div>
        {/* Filter Content */}
      </div>
      {/* !Mouth */}
      {/* Neck */}
      <div className={`filter_item filter__neck ${neck ? "" : "closed"}`}>
        {/* Filter Header */}
        <div className="filter_item__header">
          <a className="full_link c-pointer" onClick={() => setNeck(!neck)} />
          <span className="text">Neck</span>
          <span className="icon">
            <img src="svg/down.svg" alt="" className="fn__svg" />
          </span>
        </div>
        {/* !Filter Header */}
        {/* Filter Content */}
        <div className="filter_item__content">
          <div className="ic_in">
            <ul className="items">
              <li>
                <div className="item">
                  <label className="checkbox" data-category="Neck" data-id={47}>
                    <span className="text">Chill Headphones</span>
                    <span className="amount"> - 3100</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label className="checkbox" data-category="Neck" data-id={48}>
                    <span className="text">Koi Tattoo</span>
                    <span className="amount"> - 4764</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label className="checkbox" data-category="Neck" data-id={49}>
                    <span className="text">Towel</span>
                    <span className="amount"> - 1280</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
              <li>
                <div className="item">
                  <label className="checkbox" data-category="Neck" data-id={50}>
                    <span className="text">Zen Headphones</span>
                    <span className="amount"> - 2716</span>
                    <input type="checkbox" />
                    <span className="checkmark">
                      <img src="svg/checked.svg" alt="" className="fn__svg" />
                    </span>
                  </label>
                </div>
              </li>
            </ul>
          </div>
        </div>
        {/* Filter Content */}
      </div>
      {/* !Neck */}
    </div>
  );
};
export default CollectionFilter;
