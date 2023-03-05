import Link from "next/link";
import { Fragment, useState } from "react";
const Timeline = () => {
  const [active, setActive] = useState(2);
  const [activeTimeline, setActiveTimeline] = useState(2);
  const onClick = (value) => {
    setActive(value);
  };
  const activeClass = (value) =>
    value === active ? "active" : value > active ? "next" : "previous";
  const filter = (value) => (100 / active) * value;
  return (
    <Fragment>
      {/* Main Title */}
      <div className="neoh_fn_title">
        <h3 className="fn_title">Neoh’s Roadmap</h3>
        <div className="line">
          <span />
        </div>
      </div>
      {/* !Main Title */}
      {/* Timeline */}
      <div className="neoh_fn_timeline">
        {/* Timeline Content */}
        <div className="timeline_content">
          <ul className="timeline_list">
            <li className={`timeline_item ${activeClass(1)}`} data-index={1}>
              <div className="t_item">
                <div className="t_item_img">
                  <div className="neoh_fn_gallery_1_2">
                    <div className="gallery_in">
                      <div className="item row2">
                        <img src="img/timeline/1/1.jpg" alt="" />
                      </div>
                      <div className="item">
                        <img src="img/timeline/1/2.jpg" alt="" />
                      </div>
                      <div className="item">
                        <img src="img/timeline/1/3.jpg" alt="" />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="t_item_info">
                  <p className="fn_date">
                    <span>May 05, 2022</span>
                  </p>
                  <h3 className="fn_title">
                    <Link href="/roadmap-single">
                      New Character Set #12 is Coming Up
                    </Link>
                  </h3>
                  <p className="fn_desc">
                    Morbi non dignissim erat, a blandit felis. Suspendisse nec
                    lorem vel orci varius congue ut vitae est. Nam quis tempus
                    nisl. Fusce posuere nibh a mi molestie, sit amet ornare
                    lectus interdum.
                  </p>
                  <p className="fn_read">
                    <Link href="/roadmap-single">
                      <a className="neoh_fn_button only_text">
                        <span className="text">Read More</span>
                      </a>
                    </Link>
                  </p>
                </div>
              </div>
            </li>
            <li className={`timeline_item ${activeClass(2)}`} data-index={2}>
              <div className="t_item">
                <div className="t_item_img">
                  <div className="neoh_fn_gallery_1_2">
                    <div className="gallery_in">
                      <div className="item row2">
                        <img src="img/timeline/2/1.jpg" alt="" />
                      </div>
                      <div className="item">
                        <img src="img/timeline/2/2.jpg" alt="" />
                      </div>
                      <div className="item">
                        <img src="img/timeline/2/3.jpg" alt="" />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="t_item_info">
                  <p className="fn_date">
                    <span>May 27, 2022</span>
                  </p>
                  <h3 className="fn_title">
                    <Link href="/roadmap-single">
                      Female Character Set #20 is Coming Up
                    </Link>
                  </h3>
                  <p className="fn_desc">
                    Morbi non dignissim erat, a blandit felis. Suspendisse nec
                    lorem vel orci varius congue ut vitae est. Nam quis tempus
                    nisl. Fusce posuere nibh a mi molestie, sit amet ornare
                    lectus interdum.
                  </p>
                  <p className="fn_read">
                    <Link href="/roadmap-single">
                      <a className="neoh_fn_button only_text">
                        <span className="text">Read More</span>
                      </a>
                    </Link>
                  </p>
                </div>
              </div>
            </li>
            <li className={`timeline_item ${activeClass(3)}`} data-index={3}>
              <div className="t_item">
                <div className="t_item_img">
                  <div className="neoh_fn_gallery_1_2">
                    <div className="gallery_in">
                      <div className="item row2">
                        <img src="img/timeline/3/1.jpg" alt="" />
                      </div>
                      <div className="item">
                        <img src="img/timeline/3/2.jpg" alt="" />
                      </div>
                      <div className="item">
                        <img src="img/timeline/3/3.jpg" alt="" />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="t_item_info">
                  <p className="fn_date">
                    <span>June 01, 2022</span>
                  </p>
                  <h3 className="fn_title">
                    <Link href="/roadmap-single">
                      Mini Game Lounch For Community
                    </Link>
                  </h3>
                  <p className="fn_desc">
                    Morbi non dignissim erat, a blandit felis. Suspendisse nec
                    lorem vel orci varius congue ut vitae est. Nam quis tempus
                    nisl. Fusce posuere nibh a mi molestie, sit amet ornare
                    lectus interdum.
                  </p>
                  <p className="fn_read">
                    <Link href="/roadmap-single">
                      <a className="neoh_fn_button only_text">
                        <span className="text">Read More</span>
                      </a>
                    </Link>
                  </p>
                </div>
              </div>
            </li>
            <li className={`timeline_item ${activeClass(4)}`} data-index={4}>
              <div className="t_item">
                <div className="t_item_img">
                  <div className="neoh_fn_gallery_1_2">
                    <div className="gallery_in">
                      <div className="item row2">
                        <img src="img/timeline/4/1.jpg" alt="" />
                      </div>
                      <div className="item">
                        <img src="img/timeline/4/2.jpg" alt="" />
                      </div>
                      <div className="item">
                        <img src="img/timeline/4/3.jpg" alt="" />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="t_item_info">
                  <p className="fn_date">
                    <span>June 07, 2022</span>
                  </p>
                  <h3 className="fn_title">
                    <Link href="/roadmap-single">
                      New Character Set #15 is Coming Up
                    </Link>
                  </h3>
                  <p className="fn_desc">
                    Morbi non dignissim erat, a blandit felis. Suspendisse nec
                    lorem vel orci varius congue ut vitae est. Nam quis tempus
                    nisl. Fusce posuere nibh a mi molestie, sit amet ornare
                    lectus interdum.
                  </p>
                  <p className="fn_read">
                    <Link href="/roadmap-single">
                      <a className="neoh_fn_button only_text">
                        <span className="text">Read More</span>
                      </a>
                    </Link>
                  </p>
                </div>
              </div>
            </li>
            <li className={`timeline_item ${activeClass(5)}`} data-index={5}>
              <div className="t_item">
                <div className="t_item_img">
                  <div className="neoh_fn_gallery_1_2">
                    <div className="gallery_in">
                      <div className="item row2">
                        <img src="img/timeline/5/1.jpg" alt="" />
                      </div>
                      <div className="item">
                        <img src="img/timeline/5/2.jpg" alt="" />
                      </div>
                      <div className="item">
                        <img src="img/timeline/5/3.jpg" alt="" />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="t_item_info">
                  <p className="fn_date">
                    <span>June 15, 2022</span>
                  </p>
                  <h3 className="fn_title">
                    <Link href="/roadmap-single">
                      New Spirit Set #01 is Coming Up
                    </Link>
                  </h3>
                  <p className="fn_desc">
                    Morbi non dignissim erat, a blandit felis. Suspendisse nec
                    lorem vel orci varius congue ut vitae est. Nam quis tempus
                    nisl. Fusce posuere nibh a mi molestie, sit amet ornare
                    lectus interdum.
                  </p>
                  <p className="fn_read">
                    <Link href="/roadmap-single">
                      <a className="neoh_fn_button only_text">
                        <span className="text">Read More</span>
                      </a>
                    </Link>
                  </p>
                </div>
              </div>
            </li>
            <li className={`timeline_item ${activeClass(6)}`} data-index={6}>
              <div className="t_item">
                <div className="t_item_img">
                  <div className="neoh_fn_gallery_1_2">
                    <div className="gallery_in">
                      <div className="item row2">
                        <img src="img/timeline/6/1.jpg" alt="" />
                      </div>
                      <div className="item">
                        <img src="img/timeline/6/2.jpg" alt="" />
                      </div>
                      <div className="item">
                        <img src="img/timeline/6/3.jpg" alt="" />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="t_item_info">
                  <p className="fn_date">
                    <span>June 23, 2022</span>
                  </p>
                  <h3 className="fn_title">
                    <Link href="/roadmap-single">
                      New Haircut Collection #01 is Coming Up
                    </Link>
                  </h3>
                  <p className="fn_desc">
                    Morbi non dignissim erat, a blandit felis. Suspendisse nec
                    lorem vel orci varius congue ut vitae est. Nam quis tempus
                    nisl. Fusce posuere nibh a mi molestie, sit amet ornare
                    lectus interdum.
                  </p>
                  <p className="fn_read">
                    <Link href="/roadmap-single">
                      <a className="neoh_fn_button only_text">
                        <span className="text">Read More</span>
                      </a>
                    </Link>
                  </p>
                </div>
              </div>
            </li>
            <li className={`timeline_item ${activeClass(7)}`} data-index={7}>
              <div className="t_item">
                <div className="t_item_img">
                  <div className="neoh_fn_gallery_1_2">
                    <div className="gallery_in">
                      <div className="item row2">
                        <img src="img/timeline/7/1.jpg" alt="" />
                      </div>
                      <div className="item">
                        <img src="img/timeline/7/2.jpg" alt="" />
                      </div>
                      <div className="item">
                        <img src="img/timeline/7/3.jpg" alt="" />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="t_item_info">
                  <p className="fn_date">
                    <span>July 01, 2022</span>
                  </p>
                  <h3 className="fn_title">
                    <Link href="/roadmap-single">
                      New Haircut Collection #02 is Coming Up
                    </Link>
                  </h3>
                  <p className="fn_desc">
                    Morbi non dignissim erat, a blandit felis. Suspendisse nec
                    lorem vel orci varius congue ut vitae est. Nam quis tempus
                    nisl. Fusce posuere nibh a mi molestie, sit amet ornare
                    lectus interdum.
                  </p>
                  <p className="fn_read">
                    <Link href="/roadmap-single">
                      <a className="neoh_fn_button only_text">
                        <span className="text">Read More</span>
                      </a>
                    </Link>
                  </p>
                </div>
              </div>
            </li>
          </ul>
        </div>
        {/* !Timeline Content */}
        {/* Timeline Progress */}
        <div className="timeline_progress">
          {/* Nav */}
          <a
            className="nav_prev c-pointer"
            onClick={() =>
              setActiveTimeline(
                activeTimeline == 1 ? activeTimeline : activeTimeline - 1
              )
            }
          >
            <img src="svg/right-arr.svg" alt="" className="fn__svg" />
          </a>
          <a
            onClick={() =>
              setActiveTimeline(
                activeTimeline == 7 ? activeTimeline : activeTimeline + 1
              )
            }
            className="nav_next c-pointer"
          >
            <img src="svg/right-arr.svg" alt="" className="fn__svg" />
          </a>
          {/* !Nav */}
          <div className="progress_line_wrapper">
            <div
              className="progress_line"
              style={{
                width: "1645.66px",
                transform: `translateX(-${
                  (100 / activeTimeline) * (activeTimeline - 2)
                }%)`,
              }}
            >
              <ul>
                <li className={activeClass(1)}>
                  <a onClick={() => onClick(1)}>
                    <span className="text">May 05, 2022</span>
                    <span
                      className="circle"
                      style={{ filter: `brightness(${filter(1)}%)` }}
                    />
                  </a>
                </li>
                <li className={activeClass(2)}>
                  <a onClick={() => onClick(2)}>
                    <span className="text">May 27, 2022</span>
                    <span
                      className="circle"
                      style={{ filter: `brightness(${filter(2)}%)` }}
                    />
                  </a>
                </li>
                <li className={activeClass(3)}>
                  <a onClick={() => onClick(3)}>
                    <span className="text">June 01, 2022</span>
                    <span
                      className="circle"
                      style={{ filter: `brightness(${filter(3)}%)` }}
                    />
                  </a>
                </li>
                <li className={activeClass(4)}>
                  <a onClick={() => onClick(4)}>
                    <span className="text">June 07, 2022</span>
                    <span
                      className="circle"
                      style={{ filter: `brightness(${filter(4)}%)` }}
                    />
                  </a>
                </li>
                <li className={activeClass(5)}>
                  <a onClick={() => onClick(5)}>
                    <span className="text">June 15, 2022</span>
                    <span
                      className="circle"
                      style={{ filter: `brightness(${filter(5)}%)` }}
                    />
                  </a>
                </li>
                <li className={activeClass(6)}>
                  <a onClick={() => onClick(6)}>
                    <span className="text">June 23, 2022</span>
                    <span
                      className="circle"
                      style={{ filter: `brightness(${filter(6)}%)` }}
                    />
                  </a>
                </li>
                <li className={activeClass(7)}>
                  <a onClick={() => onClick(7)}>
                    <span className="text">July 01, 2022</span>
                    <span
                      className="circle"
                      style={{ filter: `brightness(${filter(7)}%)` }}
                    />
                  </a>
                </li>
              </ul>
              <span className="active_line" />
            </div>
          </div>
        </div>
        {/* !Timeline Progress */}
      </div>
      {/* !Timeline */}
    </Fragment>
  );
};
export default Timeline;
